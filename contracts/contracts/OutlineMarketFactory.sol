// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./OutlineParimutuelMarket.sol";
import "./OutlineParimutuelToken.sol";

/// @title OutlineMarketFactory
/// @notice Permissionless factory for creating Outline range prediction markets on Base.
///         Anyone can create a market for a whitelisted asset. The creator deposits the
///         opening stake and the market starts PENDING until the opposing side reaches
///         50% of the creator's stake, at which point it goes LIVE.
contract OutlineMarketFactory is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Config ──────────────────────────────────────────────────────────────

    /// @notice USDC on Base (6 decimals).
    address public immutable collateralToken;

    /// @notice Morpho Steakhouse USDC vault on Base (ERC-4626).
    address public immutable morphoVault;

    /// @notice Minimum USDC deposit to create a market (6 decimals). Default $5.
    uint256 public minCreatorDeposit;

    /// @notice Minimum market duration in seconds. Default 15 minutes.
    uint256 public minTimeframe;

    /// @notice Maximum market duration in seconds. Default 30 days.
    uint256 public maxTimeframe;

    // ─── Whitelisted assets ───────────────────────────────────────────────────

    /// @notice asset symbol → Chainlink AggregatorV3 feed address on Base.
    mapping(string => address) public assetFeeds;

    /// @notice Registered asset symbols (for enumeration).
    string[] public whitelistedAssets;

    /// @notice Quick lookup: is this asset whitelisted?
    mapping(string => bool) public isAssetWhitelisted;

    // ─── Market registry ──────────────────────────────────────────────────────

    address[] public markets;
    mapping(address => bool) public isMarket;
    mapping(address => address) public marketToBoundToken;
    mapping(address => address) public marketToBreakToken;

    /// @notice Dedup check: keccak256(asset, bandPercent, duration) → active market address.
    ///         Prevents two identical markets (same asset + band + duration) from being open simultaneously.
    mapping(bytes32 => address) public activeMarkets;

    // ─── Events ───────────────────────────────────────────────────────────────

    event AssetWhitelisted(string indexed asset, address feed);
    event AssetDelisted(string indexed asset);
    event MarketCreated(
        address indexed market,
        address indexed creator,
        address indexed boundToken,
        address breakToken,
        string asset,
        uint256 lowerBound,
        uint256 upperBound,
        uint256 expiryTimestamp,
        bool creatorSide // true = creator bet BOUND, false = creator bet BREAK
    );
    event ConfigUpdated(uint256 minCreatorDeposit, uint256 minTimeframe, uint256 maxTimeframe);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _collateralToken,
        address _morphoVault,
        address _owner
    ) Ownable(_owner) {
        collateralToken = _collateralToken;
        morphoVault = _morphoVault;
        minCreatorDeposit = 5_000_000;   // $5 USDC
        minTimeframe = 15 minutes;
        maxTimeframe = 30 days;
    }

    // ─── Owner config ─────────────────────────────────────────────────────────

    /// @notice Add or update a whitelisted asset with its Chainlink feed.
    function whitelistAsset(string calldata asset, address feed) external onlyOwner {
        require(bytes(asset).length > 0, "Empty asset");
        require(feed != address(0), "Zero feed address");
        if (!isAssetWhitelisted[asset]) {
            isAssetWhitelisted[asset] = true;
            whitelistedAssets.push(asset);
        }
        assetFeeds[asset] = feed;
        emit AssetWhitelisted(asset, feed);
    }

    /// @notice Remove an asset from the whitelist.
    function delistAsset(string calldata asset) external onlyOwner {
        require(isAssetWhitelisted[asset], "Not whitelisted");
        isAssetWhitelisted[asset] = false;
        assetFeeds[asset] = address(0);
        emit AssetDelisted(asset);
    }

    /// @notice Update market creation config.
    function setConfig(
        uint256 _minCreatorDeposit,
        uint256 _minTimeframe,
        uint256 _maxTimeframe
    ) external onlyOwner {
        require(_minCreatorDeposit > 0, "Min deposit must be > 0");
        require(_minTimeframe > 0 && _maxTimeframe >= _minTimeframe, "Invalid timeframe");
        minCreatorDeposit = _minCreatorDeposit;
        minTimeframe = _minTimeframe;
        maxTimeframe = _maxTimeframe;
        emit ConfigUpdated(_minCreatorDeposit, _minTimeframe, _maxTimeframe);
    }

    // ─── Market creation ──────────────────────────────────────────────────────

    /// @notice Create a new range prediction market.
    /// @param asset         Whitelisted asset symbol (e.g. "ETH", "BTC").
    /// @param bandPercent   Price band in basis points (e.g. 300 = ±3% from current price).
    /// @param duration      Market duration in seconds (must be within min/max timeframe).
    /// @param creatorSide   true = creator bets BOUND (price stays in range), false = BREAK.
    /// @param creatorAmount USDC amount the creator deposits as opening stake (≥ minCreatorDeposit).
    /// @param boundTokenName / boundTokenSymbol / breakTokenName / breakTokenSymbol — ERC20 metadata.
    function createMarket(
        string calldata asset,
        uint256 bandPercent,
        uint256 duration,
        bool creatorSide,
        uint256 creatorAmount,
        string calldata boundTokenName,
        string calldata boundTokenSymbol,
        string calldata breakTokenName,
        string calldata breakTokenSymbol
    ) external nonReentrant returns (address market, address boundToken, address breakToken) {
        require(isAssetWhitelisted[asset], "Asset not whitelisted");
        require(bandPercent > 0 && bandPercent <= 10000, "Band percent out of range");
        require(duration >= minTimeframe && duration <= maxTimeframe, "Duration out of range");
        require(creatorAmount >= minCreatorDeposit, "Below min deposit");

        // Dedup: prevent identical asset+band+duration market from being open simultaneously.
        bytes32 marketKey = keccak256(abi.encodePacked(asset, bandPercent, duration));
        address existing = activeMarkets[marketKey];
        if (existing != address(0)) {
            OutlineParimutuelMarket existingMarket = OutlineParimutuelMarket(existing);
            OutlineParimutuelMarket.MarketStatus existingStatus = existingMarket.status();
            (, , , uint256 existingExpiry, , , ) = existingMarket.marketConfig();
            require(
                existingStatus == OutlineParimutuelMarket.MarketStatus.SETTLED ||
                existingStatus == OutlineParimutuelMarket.MarketStatus.CANCELLED ||
                existingExpiry <= block.timestamp,
                "Identical market already active"
            );
        }

        uint256 expiryTimestamp = block.timestamp + duration;

        // Deploy position tokens (owned by factory initially; transferred to market after deploy).
        boundToken = address(new OutlineParimutuelToken(boundTokenName, boundTokenSymbol, address(this)));
        breakToken = address(new OutlineParimutuelToken(breakTokenName, breakTokenSymbol, address(this)));

        // Deploy market.
        market = address(new OutlineParimutuelMarket(
            collateralToken,
            morphoVault,
            boundToken,
            breakToken,
            msg.sender,  // creator
            address(this)
        ));

        // Transfer token ownership to market so it can mint/burn.
        OutlineParimutuelToken(boundToken).transferOwnership(market);
        OutlineParimutuelToken(breakToken).transferOwnership(market);

        // Pull creator's deposit and forward to market for initialization.
        IERC20(collateralToken).safeTransferFrom(msg.sender, market, creatorAmount);

        // Initialize — market reads its own balance for the opening stake.
        address chainlinkFeed = assetFeeds[asset];
        OutlineParimutuelMarket(market).initialize(
            asset,
            chainlinkFeed,
            bandPercent,
            expiryTimestamp,
            creatorSide,
            creatorAmount
        );

        // Register.
        markets.push(market);
        isMarket[market] = true;
        marketToBoundToken[market] = boundToken;
        marketToBreakToken[market] = breakToken;
        activeMarkets[marketKey] = market;

        // Get bounds for event.
        (, uint256 lowerBound, uint256 upperBound, , , , ) = OutlineParimutuelMarket(market).marketConfig();

        emit MarketCreated(market, msg.sender, boundToken, breakToken, asset, lowerBound, upperBound, expiryTimestamp, creatorSide);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getAllMarkets() external view returns (address[] memory) {
        return markets;
    }

    function getMarkets(uint256 offset, uint256 limit) external view returns (address[] memory result) {
        require(offset <= markets.length, "Offset out of range");
        uint256 end = offset + limit > markets.length ? markets.length : offset + limit;
        result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = markets[i];
        }
    }

    function getMarketCount() external view returns (uint256) {
        return markets.length;
    }

    function getWhitelistedAssets() external view returns (string[] memory) {
        return whitelistedAssets;
    }
}
