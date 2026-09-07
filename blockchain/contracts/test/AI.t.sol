// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AIServiceRegistry} from "../src/ai/AIServiceRegistry.sol";
import {AIAgentRegistry} from "../src/ai/AIAgentRegistry.sol";
import {AIPayments} from "../src/ai/AIPayments.sol";

contract AILayerTest is Test {
    AIServiceRegistry internal registry;
    AIAgentRegistry internal agents;
    AIPayments internal payments;

    address internal provider = makeAddr("provider");
    address internal consumer = makeAddr("consumer");
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        vm.warp(1_000_000);
        registry = new AIServiceRegistry();
        agents = new AIAgentRegistry();
        payments = new AIPayments(address(registry));
        vm.deal(consumer, 100 ether);
    }

    function _registerService(uint256 price) internal returns (uint256 id) {
        vm.prank(provider);
        id = registry.register("ipfs://service-descriptor", price);
    }

    // ------------------------------------------------------- service registry --

    function test_registerService() public {
        uint256 id = _registerService(0.01 ether);
        (address p, string memory uri, uint256 price, bool active,,) = registry.services(id);
        assertEq(p, provider);
        assertEq(uri, "ipfs://service-descriptor");
        assertEq(price, 0.01 ether);
        assertTrue(active);
        assertEq(registry.servicesOf(provider).length, 1);
    }

    function test_onlyProviderMayUpdate() public {
        uint256 id = _registerService(1);
        vm.prank(stranger);
        vm.expectRevert(AIServiceRegistry.NotProvider.selector);
        registry.update(id, "ipfs://hijacked", 999);
    }

    function test_rejectsEmptyMetadata() public {
        vm.prank(provider);
        vm.expectRevert(AIServiceRegistry.EmptyMetadata.selector);
        registry.register("", 1);
    }

    function test_deactivatedServiceIsNotActive() public {
        uint256 id = _registerService(1);
        vm.prank(provider);
        registry.setActive(id, false);
        assertFalse(registry.isActive(id));
    }

    // --------------------------------------------------------- agent registry --

    function test_registerAgent() public {
        vm.prank(consumer);
        uint256 id = agents.register(operator, "ipfs://agent", 1 ether);
        assertEq(agents.agentOf(operator), id);
        assertTrue(agents.isAuthorized(operator));
    }

    function test_operatorCannotBeReused() public {
        vm.prank(consumer);
        agents.register(operator, "ipfs://a", 1);
        vm.prank(stranger);
        vm.expectRevert(AIAgentRegistry.OperatorAlreadyRegistered.selector);
        agents.register(operator, "ipfs://b", 1);
    }

    function test_deactivatedAgentIsNotAuthorized() public {
        vm.startPrank(consumer);
        uint256 id = agents.register(operator, "ipfs://agent", 1 ether);
        agents.setActive(id, false);
        vm.stopPrank();
        assertFalse(agents.isAuthorized(operator));
    }

    function test_operatorRotationFreesTheOldAddress() public {
        address newOperator = makeAddr("newOperator");
        vm.startPrank(consumer);
        uint256 id = agents.register(operator, "ipfs://agent", 1 ether);
        agents.setOperator(id, newOperator);
        vm.stopPrank();

        assertTrue(agents.isAuthorized(newOperator));
        assertFalse(agents.isAuthorized(operator));
    }

    function test_onlyOwnerMayRotateOperator() public {
        vm.prank(consumer);
        uint256 id = agents.register(operator, "ipfs://agent", 1 ether);
        vm.prank(stranger);
        vm.expectRevert(AIAgentRegistry.NotOwner.selector);
        agents.setOperator(id, stranger);
    }

    // ---------------------------------------------------------------- payments --

    function test_fundAndRelease() public {
        uint256 serviceId = _registerService(0.01 ether);

        vm.prank(consumer);
        uint256 jobId =
            payments.fundJob{value: 1 ether}(serviceId, uint64(block.timestamp + 1 days), bytes32("req"));

        assertEq(address(payments).balance, 1 ether, "not escrowed");

        uint256 before = provider.balance;
        vm.prank(consumer);
        payments.release(jobId);

        assertEq(provider.balance - before, 1 ether, "provider not paid");
        assertEq(address(payments).balance, 0);
    }

    function test_refundOnlyAfterDeadline() public {
        uint256 serviceId = _registerService(0.01 ether);
        uint64 deadline = uint64(block.timestamp + 1 days);

        vm.prank(consumer);
        uint256 jobId = payments.fundJob{value: 2 ether}(serviceId, deadline, bytes32("req"));

        vm.prank(consumer);
        vm.expectRevert(AIPayments.DeadlineNotReached.selector);
        payments.refund(jobId);

        vm.warp(deadline + 1);
        uint256 before = consumer.balance;
        vm.prank(consumer);
        payments.refund(jobId);
        assertEq(consumer.balance - before, 2 ether);
    }

    function test_onlyConsumerMaySettle() public {
        uint256 serviceId = _registerService(1);
        vm.prank(consumer);
        uint256 jobId =
            payments.fundJob{value: 1 ether}(serviceId, uint64(block.timestamp + 1 days), bytes32(0));

        vm.prank(provider);
        vm.expectRevert(AIPayments.NotConsumer.selector);
        payments.release(jobId);
    }

    function test_cannotSettleTwice() public {
        uint256 serviceId = _registerService(1);
        vm.startPrank(consumer);
        uint256 jobId =
            payments.fundJob{value: 1 ether}(serviceId, uint64(block.timestamp + 1 days), bytes32(0));
        payments.release(jobId);
        vm.expectRevert(AIPayments.NotSettleable.selector);
        payments.release(jobId);
        vm.stopPrank();
    }

    function test_cannotFundInactiveService() public {
        uint256 serviceId = _registerService(1);
        vm.prank(provider);
        registry.setActive(serviceId, false);

        vm.prank(consumer);
        vm.expectRevert(AIPayments.ServiceInactive.selector);
        payments.fundJob{value: 1 ether}(serviceId, uint64(block.timestamp + 1 days), bytes32(0));
    }

    function test_rejectsZeroAmountAndPastDeadline() public {
        uint256 serviceId = _registerService(1);
        vm.startPrank(consumer);
        vm.expectRevert(AIPayments.ZeroAmount.selector);
        payments.fundJob{value: 0}(serviceId, uint64(block.timestamp + 1 days), bytes32(0));

        vm.expectRevert(AIPayments.DeadlineInPast.selector);
        payments.fundJob{value: 1 ether}(serviceId, uint64(block.timestamp), bytes32(0));
        vm.stopPrank();
    }
}
