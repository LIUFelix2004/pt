// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPersonhoodVerifier} from "./IPersonhoodVerifier.sol";

/**
 * @title AgentRegistry
 * @notice Sybil resistance for the launchpad.
 *
 * ## Why this exists
 *
 * The product rule is "you must mint through your own AI agent". That rule is
 * NOT cryptographically enforceable: an agent is an ordinary MCP/HTTP client,
 * and any request it can make, a shell script can also make. MCP `clientInfo`
 * is a self-reported string and is trivially forged.
 *
 * So the agent requirement buys distribution and friction, not security. The
 * actual anti-sybil boundary lives here, on-chain, and it is deliberately
 * independent of how the transaction was produced.
 *
 * Quota is bound to a registered participant, never to an agent instance —
 * otherwise a user spins up N agents and multiplies their allocation.
 */
contract AgentRegistry is Ownable {
    /// @notice Stake required to hold a participant slot. Refundable after exit cooldown.
    uint256 public stakeRequirement;

    /// @notice Token base units a registered participant may bid for, per auction.
    uint256 public defaultQuota;

    /// @notice Seconds a participant must wait between requesting exit and withdrawing.
    uint256 public exitCooldown;

    /// @notice Optional proof-of-personhood adapter. Zero address means stake-only mode.
    IPersonhoodVerifier public personhoodVerifier;

    struct Participant {
        uint256 stake;
        uint256 quotaOverride; // 0 == use defaultQuota
        uint64 registeredAt;
        uint64 exitRequestedAt; // 0 == not exiting
    }

    mapping(address => Participant) private _participants;

    event Registered(address indexed participant, uint256 stake);
    event ExitRequested(address indexed participant, uint64 withdrawableAt);
    event Exited(address indexed participant, uint256 refund);
    event QuotaOverrideSet(address indexed participant, uint256 quota);
    event ParametersUpdated(uint256 stakeRequirement, uint256 defaultQuota, uint256 exitCooldown);
    event PersonhoodVerifierSet(address indexed verifier);

    error IncorrectStake(uint256 sent, uint256 required);
    error AlreadyRegistered();
    error NotRegistered();
    error ExitNotRequested();
    error CooldownActive(uint64 withdrawableAt);
    error ExitInProgress();
    error PersonhoodProofRequired();
    error PersonhoodVerificationFailed();

    constructor(uint256 stakeRequirement_, uint256 defaultQuota_, uint256 exitCooldown_)
        Ownable(msg.sender)
    {
        stakeRequirement = stakeRequirement_;
        defaultQuota = defaultQuota_;
        exitCooldown = exitCooldown_;
    }

    /// @notice Backward-compatible stake-only registration for local development.
    /// @dev Disabled whenever a verifier is configured, so it cannot bypass personhood checks.
    function register() external payable {
        if (address(personhoodVerifier) != address(0)) revert PersonhoodProofRequired();
        _register();
    }

    /// @notice Register with an optional proof. Proof is mandatory only when a verifier is set.
    function register(bytes calldata proof) external payable {
        IPersonhoodVerifier verifier = personhoodVerifier;
        if (address(verifier) != address(0) && !verifier.verify(msg.sender, proof)) {
            revert PersonhoodVerificationFailed();
        }
        _register();
    }

    function _register() private {
        Participant storage p = _participants[msg.sender];
        if (p.registeredAt != 0) revert AlreadyRegistered();
        if (msg.value != stakeRequirement) revert IncorrectStake(msg.value, stakeRequirement);

        p.stake = msg.value;
        p.registeredAt = uint64(block.timestamp);
        emit Registered(msg.sender, msg.value);
    }

    /// @notice Begin exiting. The slot stops being valid immediately, so a
    /// participant cannot bid and simultaneously be withdrawing their collateral.
    function requestExit() external {
        Participant storage p = _participants[msg.sender];
        if (p.registeredAt == 0) revert NotRegistered();
        if (p.exitRequestedAt != 0) revert ExitInProgress();

        p.exitRequestedAt = uint64(block.timestamp);
        emit ExitRequested(msg.sender, uint64(block.timestamp + exitCooldown));
    }

    function withdrawStake() external {
        Participant storage p = _participants[msg.sender];
        if (p.registeredAt == 0) revert NotRegistered();
        if (p.exitRequestedAt == 0) revert ExitNotRequested();

        uint64 withdrawableAt = uint64(p.exitRequestedAt + exitCooldown);
        if (block.timestamp < withdrawableAt) revert CooldownActive(withdrawableAt);

        uint256 refund = p.stake;
        delete _participants[msg.sender];

        (bool ok,) = msg.sender.call{value: refund}("");
        require(ok, "refund failed");
        emit Exited(msg.sender, refund);
    }

    /// @notice True only while the participant is staked and not exiting.
    function isRegistered(address who) public view returns (bool) {
        Participant storage p = _participants[who];
        return p.registeredAt != 0 && p.exitRequestedAt == 0;
    }

    function quotaOf(address who) external view returns (uint256) {
        if (!isRegistered(who)) return 0;
        uint256 override_ = _participants[who].quotaOverride;
        return override_ == 0 ? defaultQuota : override_;
    }

    function participantOf(address who) external view returns (Participant memory) {
        return _participants[who];
    }

    function setPersonhoodVerifier(IPersonhoodVerifier verifier) external onlyOwner {
        personhoodVerifier = verifier;
        emit PersonhoodVerifierSet(address(verifier));
    }

    function setQuotaOverride(address who, uint256 quota) external onlyOwner {
        _participants[who].quotaOverride = quota;
        emit QuotaOverrideSet(who, quota);
    }

    function setParameters(uint256 stakeRequirement_, uint256 defaultQuota_, uint256 exitCooldown_)
        external
        onlyOwner
    {
        stakeRequirement = stakeRequirement_;
        defaultQuota = defaultQuota_;
        exitCooldown = exitCooldown_;
        emit ParametersUpdated(stakeRequirement_, defaultQuota_, exitCooldown_);
    }
}
