// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library OrderBookLinkedList {
    struct Order {
        address seller;
        uint256 amount;
    }

    struct Node {
        bytes32 next;
        Order order;
    }

    struct LinkedList {
        uint256 length;
        bytes32 head;
        bytes32 tail;
        mapping(bytes32 => Node) nodes;
    }

    function initHead(LinkedList storage self, address _seller, uint256 _amount)
        internal returns (bytes32)
    {
        bytes32 id = keccak256(abi.encodePacked(_seller, _amount, self.length, block.timestamp, block.prevrandao));
        self.nodes[id] = Node(0, Order(_seller, _amount));
        self.head = id;
        self.tail = id;
        self.length = 1;
        return id;
    }

    function addNode(LinkedList storage self, address _seller, uint256 _amount)
        internal returns (bytes32)
    {
        bytes32 id = keccak256(abi.encodePacked(_seller, _amount, self.length, block.timestamp, block.prevrandao));
        self.nodes[id] = Node(0, Order(_seller, _amount));
        self.nodes[self.tail].next = id;
        self.tail = id;
        self.length += 1;
        return id;
    }

    function popHead(LinkedList storage self) internal returns (bool) {
        bytes32 currHead = self.head;
        self.head = self.nodes[currHead].next;
        delete self.nodes[currHead];
        self.length -= 1;
        return true;
    }

    function deleteNode(LinkedList storage self, bytes32 _id) internal returns (bool) {
        if (self.head == _id) {
            require(self.nodes[_id].order.seller == msg.sender, "Not order owner");
            popHead(self);
            return true;
        }
        bytes32 curr = self.nodes[self.head].next;
        bytes32 prev = self.head;
        for (uint256 i = 1; i < self.length; i++) {
            if (curr == _id) {
                require(self.nodes[_id].order.seller == msg.sender, "Not order owner");
                self.nodes[prev].next = self.nodes[curr].next;
                delete self.nodes[curr];
                self.length -= 1;
                return true;
            }
            prev = curr;
            curr = self.nodes[prev].next;
        }
        revert("Order not found");
    }
}
