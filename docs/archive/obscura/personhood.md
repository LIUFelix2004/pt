# Proof-of-personhood integration

`AgentRegistry` accepts a pluggable `IPersonhoodVerifier`. The owner may set the verifier; when it is the zero address the registry deliberately runs in stake-only mode for local development. On public deployments the verifier should be non-zero and monitored.

The verifier is responsible for binding a proof to the registering account and for enforcing one active account per person. The registry's required `view` interface only returns a boolean, so nullifier consumption, replay domains, chain/application binding, and identity migration must be implemented by the adapter. Proofs are public transaction calldata and must never rely on secrecy.

## World ID

- **Integration:** requires an app/action configuration, zero-knowledge proof generation, an adapter, and careful external-nullifier design.
- **Uniqueness:** strong personhood semantics when the adapter binds the nullifier to this registry and the participant address.
- **Privacy:** generally stronger; a valid proof need not disclose civil identity, although World ID availability and enrollment are dependencies.
- **Operational cost:** higher integration and support cost, plus on-chain proof verification gas.

## Gitcoin Passport

- **Integration:** quicker for an initial deployment; an adapter can validate a signed score or attestation against a configured threshold.
- **Uniqueness:** probabilistic and policy-driven rather than a strict one-human primitive. Threshold and scoring changes require governance.
- **Privacy:** stamps can correlate wallets and social credentials and may reveal more metadata than a zero-knowledge personhood proof.
- **Operational cost:** lower initial cost, but adds oracle/attestation availability and score-model trust.

## Recommendation

Use a Gitcoin Passport adapter for a time-boxed testnet pilot because it is faster to integrate and tune. Before mainnet, prefer World ID when regional coverage is acceptable and strict one-person-one-quota plus privacy are the priority. Keep `AgentRegistry` provider-neutral so either adapter can be replaced after review.

The verifier owner is a trust assumption: it can switch or clear the verifier, and a switch affects future registrations while existing participants remain registered. Production ownership should be a monitored multisig (and ideally a timelock). `quotaOf` remains bound to the registered participant address—never to an MCP client or agent instance, both of which are trivially duplicated.
