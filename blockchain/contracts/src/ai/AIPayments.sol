// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AIServiceRegistry} from "./AIServiceRegistry.sol";

/// @title AIPayments
/// @notice Escrowed, per-job payment in KAX between a consumer and an AI service provider.
///
/// @dev The chain cannot observe whether inference happened. This contract therefore does
///      NOT adjudicate delivery or quality. It does exactly three things:
///        1. holds the consumer's funds while a job is outstanding,
///        2. releases them when the consumer acknowledges delivery,
///        3. refunds them if the provider has not been paid by the deadline.
///
///      That leaves a real, unavoidable gap: a provider who serves a request honestly can
///      still be refused payment by a dishonest consumer until the deadline passes.
///      Closing it requires an oracle or an arbiter, neither of which exists here. Do not
///      describe this as trustless settlement of AI work.
contract AIPayments {
    enum JobStatus {
        None,
        Funded,
        Released,
        Refunded
    }

    struct Job {
        address consumer;
        address provider;
        uint256 serviceId;
        uint256 amount;
        uint64 deadline;
        JobStatus status;
        /// @dev Off-chain reference to the request. Not interpreted on chain.
        bytes32 requestRef;
    }

    AIServiceRegistry public immutable REGISTRY;

    uint256 public jobCount;
    mapping(uint256 => Job) public jobs;

    event JobFunded(
        uint256 indexed jobId,
        address indexed consumer,
        address indexed provider,
        uint256 serviceId,
        uint256 amount,
        uint64 deadline,
        bytes32 requestRef
    );
    event JobReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event JobRefunded(uint256 indexed jobId, address indexed consumer, uint256 amount);

    error ZeroAmount();
    error ServiceInactive();
    error UnknownJob();
    error NotConsumer();
    error NotSettleable();
    error DeadlineInPast();
    error DeadlineNotReached();
    error TransferFailed();

    constructor(address _registry) {
        REGISTRY = AIServiceRegistry(_registry);
    }

    /// @notice Escrow payment for one job against an active service.
    /// @param _deadline After this timestamp the consumer may reclaim unreleased funds.
    function fundJob(uint256 _serviceId, uint64 _deadline, bytes32 _requestRef)
        external
        payable
        returns (uint256 jobId)
    {
        if (msg.value == 0) revert ZeroAmount();
        if (_deadline <= block.timestamp) revert DeadlineInPast();
        if (!REGISTRY.isActive(_serviceId)) revert ServiceInactive();

        (address provider,,,,,) = REGISTRY.services(_serviceId);

        jobId = jobCount;
        jobs[jobId] = Job({
            consumer: msg.sender,
            provider: provider,
            serviceId: _serviceId,
            amount: msg.value,
            deadline: _deadline,
            status: JobStatus.Funded,
            requestRef: _requestRef
        });
        jobCount = jobId + 1;

        emit JobFunded(jobId, msg.sender, provider, _serviceId, msg.value, _deadline, _requestRef);
    }

    /// @notice Consumer acknowledges delivery; the provider is paid.
    function release(uint256 _jobId) external {
        Job storage job = _load(_jobId);
        if (job.status != JobStatus.Funded) revert NotSettleable();
        if (msg.sender != job.consumer) revert NotConsumer();

        job.status = JobStatus.Released;
        uint256 amount = job.amount;

        emit JobReleased(_jobId, job.provider, amount);
        _send(job.provider, amount);
    }

    /// @notice Consumer reclaims funds that were never released, once the deadline passes.
    function refund(uint256 _jobId) external {
        Job storage job = _load(_jobId);
        if (job.status != JobStatus.Funded) revert NotSettleable();
        if (msg.sender != job.consumer) revert NotConsumer();
        if (block.timestamp < job.deadline) revert DeadlineNotReached();

        job.status = JobStatus.Refunded;
        uint256 amount = job.amount;

        emit JobRefunded(_jobId, job.consumer, amount);
        _send(job.consumer, amount);
    }

    function _load(uint256 _jobId) internal view returns (Job storage) {
        if (_jobId >= jobCount) revert UnknownJob();
        return jobs[_jobId];
    }

    /// @dev Status is written before the transfer, so a reentrant call finds the job settled.
    function _send(address _to, uint256 _amount) internal {
        (bool ok,) = payable(_to).call{value: _amount}("");
        if (!ok) revert TransferFailed();
    }
}
