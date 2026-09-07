// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KauraxSwapPair} from "./KauraxSwapPair.sol";

/// @title KauraxSwapFactory
/// @notice Creates and records liquidity pools on KAURAX.
///
/// @dev Token ordering is canonical (`token0 < token1` by address), so a pair exists at
///      most once regardless of the order a caller supplies. Pairs are deployed with
///      CREATE2 using the sorted pair as the salt, which makes a pair's address derivable
///      off chain without a lookup — and makes a duplicate deployment impossible rather
///      than merely rejected.
contract KauraxSwapFactory {
    /// @notice token0 => token1 => pair. Both directions are recorded for convenience.
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 index);

    error IdenticalAddresses();
    error ZeroAddress();
    error PairExists();

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        if (tokenA == tokenB) revert IdenticalAddresses();

        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
        if (getPair[token0][token1] != address(0)) revert PairExists();

        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        pair = address(new KauraxSwapPair{salt: salt}());
        KauraxSwapPair(pair).initialize(token0, token1);

        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @notice Address a pair would have, without deploying it.
    function pairFor(address tokenA, address tokenB) external view returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            address(this),
                            keccak256(abi.encodePacked(token0, token1)),
                            keccak256(type(KauraxSwapPair).creationCode)
                        )
                    )
                )
            )
        );
    }
}
