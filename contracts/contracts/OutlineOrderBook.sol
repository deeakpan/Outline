// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OrderBookLinkedList} from "./libraries/OrderBookLinkedList.sol";
import {OrderPriceVolumeSet} from "./libraries/OrderPriceVolumeSet.sol";

interface IOutlineMarketFactory {
    function isMarket(address market) external view returns (bool);
    function marketToBoundToken(address market) external view returns (address);
    function marketToBreakToken(address market) external view returns (address);
}

/// @title OutlineOrderBook
/// @notice Secondary market for trading BOUND/BREAK tokens between users.
///         No minting — only transfers existing tokens at user-set prices.
contract OutlineOrderBook is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using OrderBookLinkedList for OrderBookLinkedList.LinkedList;
    using OrderPriceVolumeSet for OrderPriceVolumeSet.OPVset;

    IERC20 public immutable collateralToken;
    IOutlineMarketFactory public immutable marketFactory;

    // 0.5% taker fee on buys, accumulated for protocol withdrawal
    uint16 public feeRate = 50;
    uint256 public accumulatedFee;

    // market → token → price → queue
    mapping(address => mapping(address => mapping(uint256 => OrderBookLinkedList.LinkedList))) public sellOrders;
    mapping(address => mapping(address => mapping(uint256 => OrderBookLinkedList.LinkedList))) public buyOrders;

    // Per-user order tracking: market → token → user → [orderId, price, volume]
    mapping(address => mapping(address => OrderPriceVolumeSet.OPVset)) private _userSellOrders;
    mapping(address => mapping(address => OrderPriceVolumeSet.OPVset)) private _userBuyOrders;

    // Sorted active price lists: market → token → prices[]
    mapping(address => mapping(address => uint256[])) private _sellPrices;
    mapping(address => mapping(address => uint256[])) private _buyPrices;
    mapping(address => mapping(address => mapping(uint256 => bool))) private _priceActive;

    // ─── Events ───────────────────────────────────────────────────────────────

    event SellOrderPlaced(address indexed market, address indexed token, address indexed user, uint256 price, uint256 amount, bytes32 orderId);
    event BuyOrderPlaced(address indexed market, address indexed token, address indexed user, uint256 price, uint256 amount, bytes32 orderId);
    event OrderMatched(address indexed market, address indexed token, address indexed maker, address taker, uint256 price, uint256 amount);
    event SellOrderCancelled(address indexed market, address indexed token, address indexed user, uint256 price, bytes32 orderId);
    event BuyOrderCancelled(address indexed market, address indexed token, address indexed user, uint256 price, bytes32 orderId);

    constructor(address _collateralToken, address _marketFactory, address _owner)
        Ownable(_owner)
    {
        collateralToken = IERC20(_collateralToken);
        marketFactory = IOutlineMarketFactory(_marketFactory);
    }

    // ─── Place orders ─────────────────────────────────────────────────────────

    /// @notice List tokens for sale at a fixed price.
    /// @param market  The Outline market address.
    /// @param token   BOUND or BREAK token address.
    /// @param price   Price per token in USDC (6 decimals, e.g. 0.6 USDC = 600000).
    /// @param amount  Number of tokens to sell (6 decimals).
    function placeSellOrder(address market, address token, uint256 price, uint256 amount)
        external nonReentrant returns (bytes32 orderId)
    {
        _validateMarketToken(market, token);
        require(price > 0 && amount > 0, "Invalid inputs");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 remaining = _matchSell(market, token, price, amount);

        if (remaining > 0) {
            if (sellOrders[market][token][price].length == 0) {
                orderId = sellOrders[market][token][price].initHead(msg.sender, remaining);
                _insertPrice(_sellPrices[market][token], price, true);
                _priceActive[market][token][price] = true;
            } else {
                orderId = sellOrders[market][token][price].addNode(msg.sender, remaining);
            }
            _userSellOrders[market][token]._add(msg.sender, orderId, price, remaining);
            emit SellOrderPlaced(market, token, msg.sender, price, remaining, orderId);
        }
    }

    /// @notice Place an order to buy tokens at a fixed price.
    /// @param market  The Outline market address.
    /// @param token   BOUND or BREAK token address.
    /// @param price   Max price per token in USDC (6 decimals).
    /// @param amount  Number of tokens to buy (6 decimals).
    function placeBuyOrder(address market, address token, uint256 price, uint256 amount)
        external nonReentrant returns (bytes32 orderId)
    {
        _validateMarketToken(market, token);
        require(price > 0 && amount > 0, "Invalid inputs");

        uint256 totalUsdc = (amount * price) / 1e6;
        uint256 fee = (totalUsdc * feeRate) / 10000;
        accumulatedFee += fee;
        collateralToken.safeTransferFrom(msg.sender, address(this), totalUsdc + fee);

        uint256 remaining = _matchBuy(market, token, price, amount);

        if (remaining > 0) {
            uint256 remainingUsdc = (remaining * price) / 1e6;
            if (buyOrders[market][token][price].length == 0) {
                orderId = buyOrders[market][token][price].initHead(msg.sender, remainingUsdc);
                _insertPrice(_buyPrices[market][token], price, false);
                _priceActive[market][token][price] = true;
            } else {
                orderId = buyOrders[market][token][price].addNode(msg.sender, remainingUsdc);
            }
            _userBuyOrders[market][token]._add(msg.sender, orderId, price, remainingUsdc);
            emit BuyOrderPlaced(market, token, msg.sender, price, remaining, orderId);
        }
    }

    // ─── Cancel orders ────────────────────────────────────────────────────────

    /// @notice Cancel an open sell order and reclaim tokens.
    function cancelSellOrder(address market, address token, uint256 price, bytes32 orderId)
        external nonReentrant
    {
        OrderBookLinkedList.Order memory o = sellOrders[market][token][price].nodes[orderId].order;
        require(msg.sender == o.seller, "Not order owner");

        IERC20(token).safeTransfer(msg.sender, o.amount);
        sellOrders[market][token][price].deleteNode(orderId);
        _userSellOrders[market][token]._remove(msg.sender, orderId);
        _cleanPrice(market, token, price, true);

        emit SellOrderCancelled(market, token, msg.sender, price, orderId);
    }

    /// @notice Cancel an open buy order and reclaim USDC.
    function cancelBuyOrder(address market, address token, uint256 price, bytes32 orderId)
        external nonReentrant
    {
        OrderBookLinkedList.Order memory o = buyOrders[market][token][price].nodes[orderId].order;
        require(msg.sender == o.seller, "Not order owner");

        collateralToken.safeTransfer(msg.sender, o.amount);
        buyOrders[market][token][price].deleteNode(orderId);
        _userBuyOrders[market][token]._remove(msg.sender, orderId);
        _cleanPrice(market, token, price, false);

        emit BuyOrderCancelled(market, token, msg.sender, price, orderId);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getBestAsk(address market, address token) external view returns (uint256) {
        uint256[] storage prices = _sellPrices[market][token];
        for (uint256 i = 0; i < prices.length; i++) {
            if (sellOrders[market][token][prices[i]].length > 0) return prices[i];
        }
        return 0;
    }

    function getBestBid(address market, address token) external view returns (uint256) {
        uint256[] storage prices = _buyPrices[market][token];
        for (uint256 i = 0; i < prices.length; i++) {
            if (buyOrders[market][token][prices[i]].length > 0) return prices[i];
        }
        return 0;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setFeeRate(uint16 _feeRate) external onlyOwner {
        require(_feeRate <= 200, "Max 2%");
        feeRate = _feeRate;
    }

    function collectFees() external onlyOwner {
        uint256 fee = accumulatedFee;
        accumulatedFee = 0;
        collateralToken.safeTransfer(owner(), fee);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _validateMarketToken(address market, address token) internal view {
        require(marketFactory.isMarket(market), "Invalid market");
        require(
            token == marketFactory.marketToBoundToken(market) ||
            token == marketFactory.marketToBreakToken(market),
            "Invalid token"
        );
    }

    function _matchSell(address market, address token, uint256 price, uint256 sellAmount)
        internal returns (uint256 remaining)
    {
        remaining = sellAmount;
        uint256 len = buyOrders[market][token][price].length;

        for (uint256 i = 0; i < len && remaining > 0; i++) {
            bytes32 head = buyOrders[market][token][price].head;
            uint256 buyUsdc = buyOrders[market][token][price].nodes[head].order.amount;
            uint256 buyAmount = (buyUsdc * 1e6) / price;
            address buyer = buyOrders[market][token][price].nodes[head].order.seller;

            if (remaining >= buyAmount) {
                buyOrders[market][token][price].popHead();
                _userBuyOrders[market][token]._remove(buyer, head);
                _cleanPrice(market, token, price, false);

                IERC20(token).safeTransfer(buyer, buyAmount);
                collateralToken.safeTransfer(msg.sender, buyUsdc);
                emit OrderMatched(market, token, buyer, msg.sender, price, buyAmount);
                remaining -= buyAmount;
            } else {
                uint256 matchedUsdc = (remaining * price) / 1e6;
                buyOrders[market][token][price].nodes[head].order.amount -= matchedUsdc;
                _userBuyOrders[market][token]._subVolume(buyer, head, matchedUsdc);

                IERC20(token).safeTransfer(buyer, remaining);
                collateralToken.safeTransfer(msg.sender, matchedUsdc);
                emit OrderMatched(market, token, buyer, msg.sender, price, remaining);
                remaining = 0;
            }
        }
    }

    function _matchBuy(address market, address token, uint256 price, uint256 buyAmount)
        internal returns (uint256 remaining)
    {
        remaining = buyAmount;
        uint256 len = sellOrders[market][token][price].length;

        for (uint256 i = 0; i < len && remaining > 0; i++) {
            bytes32 head = sellOrders[market][token][price].head;
            uint256 sellAmount = sellOrders[market][token][price].nodes[head].order.amount;
            address seller = sellOrders[market][token][price].nodes[head].order.seller;

            if (remaining >= sellAmount) {
                uint256 matchedUsdc = (sellAmount * price) / 1e6;
                sellOrders[market][token][price].popHead();
                _userSellOrders[market][token]._remove(seller, head);
                _cleanPrice(market, token, price, true);

                IERC20(token).safeTransfer(msg.sender, sellAmount);
                collateralToken.safeTransfer(seller, matchedUsdc);
                emit OrderMatched(market, token, seller, msg.sender, price, sellAmount);
                remaining -= sellAmount;
            } else {
                uint256 matchedUsdc = (remaining * price) / 1e6;
                sellOrders[market][token][price].nodes[head].order.amount -= remaining;
                _userSellOrders[market][token]._subVolume(seller, head, remaining);

                IERC20(token).safeTransfer(msg.sender, remaining);
                collateralToken.safeTransfer(seller, matchedUsdc);
                emit OrderMatched(market, token, seller, msg.sender, price, remaining);
                remaining = 0;
            }
        }
    }

    function _insertPrice(uint256[] storage arr, uint256 price, bool ascending) internal {
        uint256 i = 0;
        while (i < arr.length && (ascending ? arr[i] < price : arr[i] > price)) i++;
        arr.push(0);
        for (uint256 j = arr.length - 1; j > i; j--) arr[j] = arr[j - 1];
        arr[i] = price;
    }

    function _cleanPrice(address market, address token, uint256 price, bool isSell) internal {
        if (sellOrders[market][token][price].length == 0 &&
            buyOrders[market][token][price].length == 0)
        {
            _priceActive[market][token][price] = false;
            uint256[] storage arr = isSell ? _sellPrices[market][token] : _buyPrices[market][token];
            for (uint256 i = 0; i < arr.length; i++) {
                if (arr[i] == price) {
                    arr[i] = arr[arr.length - 1];
                    arr.pop();
                    return;
                }
            }
        }
    }
}
