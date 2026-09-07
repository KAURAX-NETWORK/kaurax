// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title AIServiceRegistry
/// @notice On-chain directory of AI services offered on KAURAX.
///
/// @dev What this contract does and does not do, stated plainly:
///        - It records who offers what, at what price, and where to reach them.
///        - It does NOT verify that a provider exists, is capable, or ever serves a
///          request. Registration is permissionless and self-asserted.
///        - Inference does not happen here. `metadataURI` points off chain.
///      Treat every field as a claim by its provider, not as an attestation.
contract AIServiceRegistry {
    struct Service {
        address provider;
        /// @dev Off-chain descriptor: model, endpoint, terms. Content is not validated.
        string metadataURI;
        /// @dev Price per call in KAX (wei). Informational; AIPayments enforces amounts.
        uint256 pricePerCall;
        bool active;
        uint64 registeredAt;
        uint64 updatedAt;
    }

    uint256 public serviceCount;

    mapping(uint256 => Service) public services;
    mapping(address => uint256[]) internal _byProvider;

    event ServiceRegistered(
        uint256 indexed serviceId, address indexed provider, string metadataURI, uint256 pricePerCall
    );
    event ServiceUpdated(uint256 indexed serviceId, string metadataURI, uint256 pricePerCall);
    event ServiceActiveChanged(uint256 indexed serviceId, bool active);

    error NotProvider();
    error UnknownService();
    error EmptyMetadata();

    modifier onlyProvider(uint256 _serviceId) {
        if (_serviceId >= serviceCount) revert UnknownService();
        if (services[_serviceId].provider != msg.sender) revert NotProvider();
        _;
    }

    function register(string calldata _metadataURI, uint256 _pricePerCall)
        external
        returns (uint256 serviceId)
    {
        if (bytes(_metadataURI).length == 0) revert EmptyMetadata();

        serviceId = serviceCount;
        services[serviceId] = Service({
            provider: msg.sender,
            metadataURI: _metadataURI,
            pricePerCall: _pricePerCall,
            active: true,
            registeredAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp)
        });
        _byProvider[msg.sender].push(serviceId);
        serviceCount = serviceId + 1;

        emit ServiceRegistered(serviceId, msg.sender, _metadataURI, _pricePerCall);
    }

    function update(uint256 _serviceId, string calldata _metadataURI, uint256 _pricePerCall)
        external
        onlyProvider(_serviceId)
    {
        if (bytes(_metadataURI).length == 0) revert EmptyMetadata();
        Service storage s = services[_serviceId];
        s.metadataURI = _metadataURI;
        s.pricePerCall = _pricePerCall;
        s.updatedAt = uint64(block.timestamp);
        emit ServiceUpdated(_serviceId, _metadataURI, _pricePerCall);
    }

    function setActive(uint256 _serviceId, bool _active) external onlyProvider(_serviceId) {
        services[_serviceId].active = _active;
        services[_serviceId].updatedAt = uint64(block.timestamp);
        emit ServiceActiveChanged(_serviceId, _active);
    }

    function servicesOf(address _provider) external view returns (uint256[] memory) {
        return _byProvider[_provider];
    }

    function isActive(uint256 _serviceId) external view returns (bool) {
        return _serviceId < serviceCount && services[_serviceId].active;
    }
}
