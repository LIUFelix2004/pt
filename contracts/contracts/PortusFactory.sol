// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPortusFactory} from "./interfaces/IPortusFactory.sol";
import {IPortusPool} from "./interfaces/IPortusPool.sol";
import {IPortusLocker} from "./interfaces/IPortusLocker.sol";
import {IPortusFeeSplitter} from "./interfaces/IPortusFeeSplitter.sol";
import {IPortusDistributor} from "./interfaces/IPortusDistributor.sol";
import {IPortusFlywheel} from "./interfaces/IPortusFlywheel.sol";
import {
    LaunchParams, Launch, QuoteAssetConfig, SaleConfig, UnderfillRule, MintLaunchParams, MintTax
} from "./interfaces/PortusTypes.sol";
import {PortusLocker} from "./PortusLocker.sol";
import {PortusFeeSplitter} from "./PortusFeeSplitter.sol";
import {PortusDistributor} from "./PortusDistributor.sol";
import {PortusFlywheel} from "./PortusFlywheel.sol";
import {
    TokenDeployer,
    PoolDeployer,
    SaleDeployer,
    TreasuryDeployer,
    MintTokenDeployer,
    TaxPoolDeployer,
    EmissionDeployer
} from "./libraries/PortusDeployers.sol";
import {PortusMath} from "./libraries/PortusMath.sol";

interface IEmissionWiring {
    function bindSale(address sale) external;
}

interface IMintTokenWiring {
    function setMinter(address minter) external;
}

/// @notice Permissionless launch factory.
///
/// One `createLaunch` deploys a token, its sale, its pool and its treasury in a
/// single transaction and hands the entire fixed supply to the sale. Every
/// parameter is immutable from that moment, including the four-way fee split.
///
/// Privileged roles, both fixed at deployment:
/// - `quoteAdmin` curates which quote assets *future* launches may use; it
///   cannot touch an existing launch;
/// - the Distributor's `rootPublisher` publishes incentive / reward Merkle
///   roots, bounded by what each pot holds and delayed by a challenge period.
///
/// No owner, no proxy, no pause, no upgrade.
contract PortusFactory is IPortusFactory {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    /// @dev Must stay divisible by 2·BPS so the supply split is exact (§3.1).
    uint256 public constant TOTAL_SUPPLY = 1e27;
    uint16 public constant CREATOR_SHARE_MAX_BPS = 4_000;
    uint16 public constant INCENTIVE_MAX_BPS = 3_000;
    uint64 public constant MIN_DURATION = 1 hours;
    uint64 public constant MAX_DURATION = 14 days;
    uint64 public constant MAX_START_DELAY = 30 days;
    uint256 public constant PRICE_GRANULARITY = 1e6;
    uint16 public constant MIN_RELEASE_RATE_BPS = 10; // 0.1% per day
    uint16 public constant MAX_RELEASE_RATE_BPS = 100; // 1% per day
    // Mint-mode bounds.
    uint256 public constant MIN_INITIAL_SUPPLY = 2e18;
    uint256 public constant MAX_MINT_SUPPLY = 1e30;
    uint16 public constant MAX_MONTHLY_GROWTH_BPS = 2_000;
    uint256 public constant MAX_SCHEDULE_MONTHS = 600;
    uint16 public constant MAX_SIDE_TAX_BPS = 1_000;
    uint16 public constant MIN_DUMP_THRESHOLD_BPS = 100;
    uint16 public constant MAX_DUMP_THRESHOLD_BPS = 5_000;

    address public immutable quoteAdmin;
    IPortusLocker public immutable locker;
    IPortusFeeSplitter public immutable feeSplitter;
    IPortusDistributor public immutable distributor;
    IPortusFlywheel public immutable flywheel;

    mapping(address quoteAsset => QuoteAssetConfig) public quoteAssets;
    Launch[] internal _launches;
    mapping(address token => uint256 launchIdPlusOne) public launchIdOf;
    mapping(address => bool) public isSale;
    mapping(address => bool) public isPool;
    /// @notice Mint-mode pools (taxed, no LP shares). Kept apart from `isPool`
    /// so the Flywheel, which needs quote-fee pools, never selects them.
    mapping(address => bool) public isMintPool;
    mapping(address token => address) public emissionOf;

    constructor(address quoteAdmin_, address ecosystem_, address rootPublisher_) {
        if (quoteAdmin_ == address(0) || ecosystem_ == address(0) || rootPublisher_ == address(0)) revert ZeroAddress();
        quoteAdmin = quoteAdmin_;
        // Created here so their `factory` is this contract from block one: no
        // post-deploy initializer, no window where they point at nothing.
        locker = new PortusLocker();
        flywheel = new PortusFlywheel(address(this));
        feeSplitter = new PortusFeeSplitter(address(this), ecosystem_, address(flywheel));
        distributor = new PortusDistributor(address(this), rootPublisher_);
    }

    // ─── quote-asset curation ─────────────────────────────────────────────────

    function setQuoteAsset(
        address asset,
        bool allowed,
        bool freezable,
        uint128 minFdv,
        uint128 maxFdv,
        address priceSource,
        uint128 minPoolLiquidity
    ) external {
        if (msg.sender != quoteAdmin) revert NotQuoteAdmin();
        if (asset == address(0)) revert ZeroAddress();
        if (minFdv > maxFdv) revert InvalidFdvBounds();

        QuoteAssetConfig storage cfg = quoteAssets[asset];
        if (!cfg.registered) {
            uint8 decimals = IERC20Metadata(asset).decimals();
            if (decimals > 18) revert UnsupportedDecimals();
            cfg.registered = true;
            cfg.decimals = decimals;
        }
        cfg.allowed = allowed;
        cfg.freezable = freezable;
        cfg.minFdv = minFdv;
        cfg.maxFdv = maxFdv;
        cfg.priceSource = priceSource;
        cfg.minPoolLiquidity = minPoolLiquidity;
        emit QuoteAssetSet(asset, allowed, freezable, cfg.decimals, minFdv, maxFdv);
        emit QuoteAssetChecks(asset, priceSource, minPoolLiquidity);
    }

    // ─── launch ───────────────────────────────────────────────────────────────

    /// @dev Supply split and reduced price, carried in memory to keep the stack shallow.
    struct Split {
        uint256 qSale;
        uint256 qLp;
        uint256 qInc;
        uint256 r;
        uint256 s;
    }

    function createLaunch(LaunchParams calldata p)
        external
        returns (uint256 launchId, address token, address sale, address pool)
    {
        Split memory x = _validate(p);
        address creatorRecipient = p.creatorRecipient == address(0) ? msg.sender : p.creatorRecipient;

        token = TokenDeployer.deploy(p.name, p.symbol, TOTAL_SUPPLY);
        pool = PoolDeployer.deploy(token, p.quoteAsset, p.feeBps, address(locker), address(feeSplitter));
        address treasury = TreasuryDeployer.deploy(token, p.quoteAsset, pool, address(distributor), p.treasuryMode);
        sale = SaleDeployer.deploy(_saleConfig(p, x, token, pool, treasury));
        // Breaks the Pool <-> Sale construction cycle. Only callable by this
        // factory, once, inside this transaction.
        IPortusPool(pool).bindSale(sale);

        IERC20(token).safeTransfer(sale, TOTAL_SUPPLY);
        assert(IERC20(token).balanceOf(sale) == TOTAL_SUPPLY && IERC20(token).balanceOf(address(this)) == 0);

        isSale[sale] = true;
        isPool[pool] = true;
        locker.registerPool(pool, token);
        feeSplitter.registerPool(pool, token, p.quoteAsset, creatorRecipient, p.creatorShareBps, treasury);
        distributor.registerLaunch(token, sale, treasury, p.releaseMode, p.releaseRateBps);

        launchId = _launches.length;
        _launches.push(
            Launch({
                creator: msg.sender,
                token: token,
                sale: sale,
                pool: pool,
                treasury: treasury,
                quoteAsset: p.quoteAsset,
                createdAt: uint64(block.timestamp)
            })
        );
        launchIdOf[token] = launchId + 1;

        _emitCreated(launchId, p, x, token, sale, pool);
        _emitRules(launchId, p);
        emit LaunchEconomics(launchId, treasury, creatorRecipient, p.treasuryMode, p.releaseMode, p.releaseRateBps);
    }

    // ─── mint-mode launch ─────────────────────────────────────────────────────

    /// @notice A launch whose initial supply is sold at a fixed price (half to
    /// subscribers, half paired with the raise in a taxed pool) and whose
    /// remaining supply is minted on a fixed schedule for holders and referrers.
    function createMintLaunch(MintLaunchParams calldata p)
        external
        returns (uint256 launchId, address token, address sale, address pool)
    {
        Split memory x = _validateMint(p);

        token = MintTokenDeployer.deploy(p.name, p.symbol, p.initialSupply, p.maxSupply);
        pool = TaxPoolDeployer.deploy(token, p.quoteAsset, p.tax);
        address emission =
            EmissionDeployer.deploy(token, address(distributor), p.initialSupply, p.maxSupply, p.staticBps, p.schedule);
        sale = SaleDeployer.deploy(_mintSaleConfig(p, x, token, pool));
        IPortusPool(pool).bindSale(sale);
        IEmissionWiring(emission).bindSale(sale);
        IMintTokenWiring(token).setMinter(emission);

        IERC20(token).safeTransfer(sale, p.initialSupply);
        assert(IERC20(token).balanceOf(sale) == p.initialSupply && IERC20(token).balanceOf(address(this)) == 0);

        isSale[sale] = true;
        isMintPool[pool] = true;
        emissionOf[token] = emission;
        distributor.registerLaunch(token, sale, emission, 0, 0);

        launchId = _launches.length;
        _launches.push(
            Launch({
                creator: msg.sender,
                token: token,
                sale: sale,
                pool: pool,
                treasury: emission,
                quoteAsset: p.quoteAsset,
                createdAt: uint64(block.timestamp)
            })
        );
        launchIdOf[token] = launchId + 1;

        emit LaunchCreated(
            launchId, msg.sender, token, sale, pool, p.quoteAsset, p.raiseTarget, x.qSale, x.qLp, 0, x.r, x.s
        );
        _emitMintRules(launchId, p);
        emit MintLaunch(launchId, token, emission, p.initialSupply, p.maxSupply, p.staticBps, p.schedule);
        emit MintTaxSet(launchId, token, p.tax);
    }

    /// @dev Rounding dust goes to the pool, whose `sync` folds it into the locked liquidity.
    function _mintSaleConfig(MintLaunchParams calldata p, Split memory x, address token, address pool)
        private
        view
        returns (SaleConfig memory)
    {
        return SaleConfig({
            token: token,
            quoteAsset: p.quoteAsset,
            pool: pool,
            treasury: pool,
            distributor: address(distributor),
            creator: msg.sender,
            raiseTarget: p.raiseTarget,
            qSale: x.qSale,
            qLp: x.qLp,
            qInc: 0,
            priceNum: x.r,
            priceDen: x.s,
            startTime: p.startTime,
            endTime: p.startTime + p.duration,
            publicOpenAt: p.publicOpenAt,
            publicCap: p.publicCap,
            merkleRoot: p.merkleRoot,
            underRule: p.underRule,
            minFillBps: p.minFillBps
        });
    }

    function _emitMintRules(uint256 launchId, MintLaunchParams calldata p) private {
        emit LaunchRules(
            launchId,
            0,
            0,
            0,
            p.startTime,
            p.startTime + p.duration,
            p.publicOpenAt,
            p.publicCap,
            p.merkleRoot,
            uint8(p.underRule),
            p.minFillBps,
            0,
            p.metadataHash
        );
    }

    function _validateMint(MintLaunchParams calldata p) private view returns (Split memory x) {
        QuoteAssetConfig memory cfg = quoteAssets[p.quoteAsset];
        if (!cfg.allowed) revert QuoteAssetNotAllowed(p.quoteAsset);

        uint256 s0 = p.initialSupply;
        if (s0 < MIN_INITIAL_SUPPLY || s0 % 2 != 0 || p.maxSupply < s0 || p.maxSupply > MAX_MINT_SUPPLY) {
            revert InvalidSupply();
        }
        x.qSale = s0 / 2;
        x.qLp = x.qSale;

        uint256 R = p.raiseTarget;
        if (R == 0 || R >= 2 ** 112) revert InvalidRaiseTarget();
        uint256 g = PortusMath.gcd(R, x.qSale);
        x.r = R / g;
        x.s = x.qSale / g;
        // FDV at full mint = R·maxSupply / qSale, compared by cross-multiplication.
        if (uint256(cfg.minFdv) * x.qSale > R * p.maxSupply || R * p.maxSupply > uint256(cfg.maxFdv) * x.qSale) {
            revert FdvOutOfBounds();
        }
        if (x.r * PRICE_GRANULARITY > R) revert PriceNotGranular(x.r);

        _validateWindow(p.startTime, p.duration, p.merkleRoot, p.publicOpenAt, p.publicCap, p.underRule, p.minFillBps);
        if (p.staticBps > BPS) revert InvalidMintSchedule();
        _validateSchedule(p);
        _validateTax(p.tax);

        uint256 nameLen = bytes(p.name).length;
        uint256 symbolLen = bytes(p.symbol).length;
        if (nameLen == 0 || nameLen > 32 || symbolLen == 0 || symbolLen > 11) revert InvalidMetadata();
    }

    function _validateSchedule(MintLaunchParams calldata p) private pure {
        uint256 total;
        bool ended;
        for (uint256 i = 0; i < 4; i++) {
            uint256 months = p.schedule.months[i];
            uint256 growth = p.schedule.growthBps[i];
            if (months == 0) {
                if (growth != 0) revert InvalidMintSchedule();
                ended = true;
                continue;
            }
            if (ended || growth == 0 || growth > MAX_MONTHLY_GROWTH_BPS) revert InvalidMintSchedule();
            total += months;
        }
        if (total == 0 || total > MAX_SCHEDULE_MONTHS) revert InvalidMintSchedule();
    }

    function _validateTax(MintTax calldata t) private pure {
        if (uint256(t.buyBurnBps) + t.buyCommunityBps + t.buyFoundationBps > MAX_SIDE_TAX_BPS) revert InvalidTax();
        if (uint256(t.sellBurnBps) + t.sellCommunityBps + t.sellTechBps > MAX_SIDE_TAX_BPS) revert InvalidTax();
        if ((t.buyCommunityBps > 0 || t.sellCommunityBps > 0) && t.community == address(0)) revert InvalidTax();
        if (t.buyFoundationBps > 0 && t.foundation == address(0)) revert InvalidTax();
        if (t.sellTechBps > 0 && t.tech == address(0)) revert InvalidTax();
        if (t.dumpThresholdBps == 0) {
            if (t.dumpBurnShareBps != 0) revert InvalidTax();
        } else {
            if (t.dumpThresholdBps < MIN_DUMP_THRESHOLD_BPS || t.dumpThresholdBps > MAX_DUMP_THRESHOLD_BPS) {
                revert InvalidTax();
            }
            if (t.dumpBurnShareBps > BPS) revert InvalidTax();
            if (t.dumpBurnShareBps < BPS && t.market == address(0)) revert InvalidTax();
        }
    }

    function _saleConfig(LaunchParams calldata p, Split memory x, address token, address pool, address treasury)
        private
        view
        returns (SaleConfig memory)
    {
        return SaleConfig({
            token: token,
            quoteAsset: p.quoteAsset,
            pool: pool,
            treasury: treasury,
            distributor: address(distributor),
            creator: msg.sender,
            raiseTarget: p.raiseTarget,
            qSale: x.qSale,
            qLp: x.qLp,
            qInc: x.qInc,
            priceNum: x.r,
            priceDen: x.s,
            startTime: p.startTime,
            endTime: p.startTime + p.duration,
            publicOpenAt: p.publicOpenAt,
            publicCap: p.publicCap,
            merkleRoot: p.merkleRoot,
            underRule: p.underRule,
            minFillBps: p.minFillBps
        });
    }

    function _emitCreated(
        uint256 launchId,
        LaunchParams calldata p,
        Split memory x,
        address token,
        address sale,
        address pool
    ) private {
        emit LaunchCreated(
            launchId, msg.sender, token, sale, pool, p.quoteAsset, p.raiseTarget, x.qSale, x.qLp, x.qInc, x.r, x.s
        );
    }

    function _emitRules(uint256 launchId, LaunchParams calldata p) private {
        emit LaunchRules(
            launchId,
            p.feeBps,
            p.creatorShareBps,
            p.incentiveBps,
            p.startTime,
            p.startTime + p.duration,
            p.publicOpenAt,
            p.publicCap,
            p.merkleRoot,
            uint8(p.underRule),
            p.minFillBps,
            p.treasuryMode,
            p.metadataHash
        );
    }

    function _validate(LaunchParams calldata p) private view returns (Split memory x) {
        QuoteAssetConfig memory cfg = quoteAssets[p.quoteAsset];
        if (!cfg.allowed) revert QuoteAssetNotAllowed(p.quoteAsset);
        if (p.feeBps % 100 != 0 || p.feeBps < 100 || p.feeBps > 500) revert InvalidFeeTier(p.feeBps);
        if (p.creatorShareBps > CREATOR_SHARE_MAX_BPS) revert CreatorShareTooHigh();
        if (p.incentiveBps > INCENTIVE_MAX_BPS) revert IncentiveTooHigh();

        (x.qSale, x.qLp, x.qInc, x.r, x.s) = previewPrice(p.raiseTarget, p.incentiveBps);
        assert(x.qSale + x.qLp + x.qInc == TOTAL_SUPPLY);
        uint256 qSale = x.qSale;

        uint256 R = p.raiseTarget;
        if (R == 0 || R >= 2 ** 112) revert InvalidRaiseTarget();
        // FDV = R·S / qSale, compared by cross-multiplication (no division).
        if (uint256(cfg.minFdv) * qSale > R * TOTAL_SUPPLY || R * TOTAL_SUPPLY > uint256(cfg.maxFdv) * qSale) {
            revert FdvOutOfBounds();
        }
        // g = R / r >= 1e6 bounds the SHRINK quote dust (< r) to R / 1e6.
        if (x.r * PRICE_GRANULARITY > R) revert PriceNotGranular(x.r);

        _validateWindow(p.startTime, p.duration, p.merkleRoot, p.publicOpenAt, p.publicCap, p.underRule, p.minFillBps);

        if (p.treasuryMode > 1) revert InvalidTreasuryMode();
        bool rateOk = p.incentiveBps > 0
            ? (p.releaseRateBps >= MIN_RELEASE_RATE_BPS && p.releaseRateBps <= MAX_RELEASE_RATE_BPS)
            : p.releaseRateBps == 0;
        if (p.releaseMode > 1 || !rateOk) revert InvalidRelease();

        uint256 nameLen = bytes(p.name).length;
        uint256 symbolLen = bytes(p.symbol).length;
        if (nameLen == 0 || nameLen > 32 || symbolLen == 0 || symbolLen > 11) revert InvalidMetadata();
    }

    /// @dev Subscription window, paths and underfill rule, shared by both launch kinds.
    function _validateWindow(
        uint64 startTime,
        uint64 duration,
        bytes32 merkleRoot,
        uint64 publicOpenAt,
        uint256 publicCap,
        UnderfillRule underRule,
        uint16 minFillBps
    ) private view {
        if (
            startTime < block.timestamp || startTime > block.timestamp + MAX_START_DELAY || duration < MIN_DURATION
                || duration > MAX_DURATION
        ) revert InvalidSchedule();
        uint64 endTime = startTime + duration;

        if (merkleRoot == bytes32(0) && publicOpenAt != startTime) revert NoSubscriptionPath();
        if (publicOpenAt != 0) {
            if (publicOpenAt < startTime || publicOpenAt >= endTime || publicCap == 0) revert InvalidPublicPhase();
        } else if (publicCap != 0) {
            revert InvalidPublicPhase();
        }

        if (minFillBps > BPS || (underRule == UnderfillRule.REFUND && minFillBps != 0)) revert InvalidUnderfill();
    }

    // ─── views ────────────────────────────────────────────────────────────────

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    function launchAt(uint256 launchId) external view returns (Launch memory) {
        return _launches[launchId];
    }

    function launchOf(address token) external view returns (Launch memory launch) {
        uint256 idPlusOne = launchIdOf[token];
        if (idPlusOne != 0) launch = _launches[idPlusOne - 1];
    }

    /// @notice Supply split and reduced price for a raise target.
    /// qSale = qLp = S(B-X)/(2B), qInc = S·X/B; p = R/qSale = r/s with gcd(r,s) = 1.
    function previewPrice(uint256 raiseTarget, uint16 incentiveBps)
        public
        pure
        returns (uint256 qSale, uint256 qLp, uint256 qInc, uint256 r, uint256 s)
    {
        qSale = (TOTAL_SUPPLY * (BPS - incentiveBps)) / (2 * BPS);
        qLp = qSale;
        qInc = (TOTAL_SUPPLY * incentiveBps) / BPS;
        uint256 g = PortusMath.gcd(raiseTarget, qSale);
        r = raiseTarget / g;
        s = qSale / g;
    }
}
