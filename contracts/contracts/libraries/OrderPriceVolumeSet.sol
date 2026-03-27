// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library OrderPriceVolumeSet {
    struct OPVnode {
        bytes32 _orderId;
        uint256 _price;
        uint256 _volume;
    }

    struct OPVset {
        mapping(address => OPVnode[]) _orders;
        mapping(bytes32 => uint256) _indexes;
    }

    function _contains(OPVset storage set, bytes32 orderId) internal view returns (bool) {
        return set._indexes[orderId] != 0;
    }

    function _add(OPVset storage set, address user, bytes32 orderId, uint256 price, uint256 volume)
        internal returns (bool)
    {
        if (!_contains(set, orderId)) {
            set._orders[user].push(OPVnode(orderId, price, volume));
            set._indexes[orderId] = set._orders[user].length;
            return true;
        }
        return false;
    }

    function _remove(OPVset storage set, address user, bytes32 orderId) internal returns (bool) {
        uint256 idx = set._indexes[orderId];
        if (idx != 0) {
            uint256 toDelete = idx - 1;
            uint256 last = set._orders[user].length - 1;
            if (last != toDelete) {
                OPVnode memory lastNode = set._orders[user][last];
                set._orders[user][toDelete] = lastNode;
                set._indexes[lastNode._orderId] = idx;
            }
            set._orders[user].pop();
            delete set._indexes[orderId];
            return true;
        }
        return false;
    }

    function _subVolume(OPVset storage set, address user, bytes32 orderId, uint256 volume)
        internal returns (bool)
    {
        uint256 idx = set._indexes[orderId];
        if (idx != 0) {
            set._orders[user][idx - 1]._volume -= volume;
            return true;
        }
        return false;
    }
}
