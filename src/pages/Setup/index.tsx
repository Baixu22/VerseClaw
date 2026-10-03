/**
 * Setup Wizard Page
 * First-time setup experience for new users
 */
import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { toast } from 'sonner';
import { hostApi } from '@/lib/host-api';
import { BrandLogo } from '@/components/brand/BrandLogo';
import {
  ModelStepContent,
  ProviderStepContent,
  type PendingProviderSetup,
} from './ProviderModelSteps';
import { WorkspaceStepContent, type WorkspaceSetupOutcome } from './WorkspaceStep';
import { SetupGridBackdrop } from './SetupGridBackdrop';
import { SetupActionButton } from './SetupActionButton';
import { SetupCompleteMark } from './SetupCompleteMark';
import { isSetupVerificationComplete } from '@/lib/setup-provider';

/**
 * Step transition choreography, ported from the rogierdeboeve reference.
 *
 * The curve is the reference's --expo-out verbatim — fast departure, long
 * decelerating tail — and is the same value as the --ease-enter token.
 *
 * The durations are not verbatim, for two separate reasons.
 *
 * ENTRANCE (0.6s, not the reference's 1.8s). 1.8s is right for a portfolio you
 * are browsing and wrong for a wizard you are trying to get through — after
 * clicking Next it is just dead time. 0.6s keeps the whole shape of the curve:
 * expo.out spends its first third covering most of the distance, so the step
 * is legible almost immediately and only the last few pixels are still
 * settling.
 *
 * EXIT (0.12s, unstaggered). This one is a correctness constraint, not taste.
 * AnimatePresence mode="wait" holds the incoming step until the outgoing one
 * has fully left, so exit duration is latency on every single Next click, paid
 * before the next step even mounts. A staggered exit compounds that per child.
 * Exit therefore uses an accelerating ease and gets out of the way fast, which
 * is also what codex-tokens.css prescribes for anything leaving.
 *
 * THE ARC
 * The reference lays its projects out on a ring and puts the camera just
 * inside it: each item sits at (-sin(θi)·r, 0, cos(θi)·r) and faces the centre,
 * with the camera at z = r - 0.3 (webgl.ts:6560-6585). Rotating the ring sweeps
 * the next item into view along a curve rather than sliding it flat.
 *
 * In CSS 3D that construction is the matrix product
 *
 *     translateZ(-r) · rotateY(θ) · translateZ(+r)
 *
 * which maps the card to (r·sinθ, 0, r·cosθ - r) while turning it by θ: it
 * arrives along the ring, side-first, and lands at exactly z = 0 when θ = 0.
 *
 * THAT PRODUCT CANNOT LIVE ON ONE NODE.
 * framer-motion builds every transform string in one fixed order —
 * translate, then scale, then rotate (transform-box order in its own
 * `buildTransform`). So a single motion node asked for `rotateY` and `z`
 * emits `translateZ(z) rotateY(θ)`, i.e. T·R with no trailing T. The card
 * then travels straight down the view axis: at r = 900 / perspective = 1400
 * it enters at scale 1400/(1400+900) ≈ 0.61 dead centre and inflates to 1.0,
 * with ~0px of lateral travel. That is a dolly zoom, not the reference's
 * sweep, and it re-rasterises every glyph in the card on every frame.
 *
 * So the ring is spelled across three nodes, which is the minimum the fixed
 * order allows:
 *
 *   .setup-arc-stage   perspective (the camera). Carries the opacity fade.
 *   .setup-arc-orbit   translateZ(-r) rotateY(θ) — the only animated node.
 *   .setup-card-3d     translateZ(+r) — static, from CSS.
 *
 * OPACITY AND preserve-3d MUST NOT SHARE A NODE.
 * An element with opacity < 1 is a grouping element, and grouping forces its
 * `transform-style: preserve-3d` to compute to `flat`. Fading the orbit node
 * would therefore flatten the card's translateZ(+r) into the orbit's plane
 * and silently collapse the ring back to a slide. The fade lives on the
 * stage, which supplies `perspective` (unaffected by grouping) and never
 * declares preserve-3d.
 *
 * The reference's own radius formula is r = width/2 / tan(π/count). With seven
 * steps that gives θ ≈ 51°, which is right for browsing artwork and wrong for
 * reading a form — at that angle the far edge of the card is unreadable. The
 * same formula with a wider virtual ring gives ARC_DEGREES/ARC_RADIUS below:
 * enough curvature to read as rotation, not enough to fight the text.
 *
 * With the product correct, θ = 22° at r = 900 resolves to 337px of lateral
 * travel (half the 672px card) against only 66px of depth — a 0.96→1.00 scale
 * swing instead of 0.61→1.00. The card reads as swinging in along the ring,
 * and near-unity scale is also why the text stays sharp: the compositor is
 * re-transforming a cached raster rather than re-shaping every glyph.
 *
 * STALE CLICKS ARE GUARDED IN THE HANDLER, NOT THE DOM
 * Under AnimatePresence mode="wait" the outgoing step stays mounted while it
 * leaves, so a fast second Next click can land on the step that is already
 * going away and fire its handler a second time — silently advancing twice, or
 * past the end. The fix belongs in handleNext/handleBack, which ignore a click
 * whose originating step is no longer the current one.
 *
 * Doing this with `pointerEvents` inside the variants instead looks tempting
 * and is a trap: `animate` would carry no pointerEvents of its own, so every
 * re-render re-resolves it toward the `initial` value, `transitionEnd` sets it
 * back, and the card re-runs its rotation forever. The card never settles, and
 * Playwright — which requires two consecutive stable bounding boxes — can then
 * never click anything inside it.
 */
const EXPO_OUT = [0.19, 1, 0.22, 1] as const;
const EASE_IN = [0.4, 0, 1, 1] as const;

/** Swing angle and ring radius, in the reference's own construction. */
const ARC_DEGREES = 22;
const ARC_RADIUS = 900;
const ARC_PERSPECTIVE = 1400;

const stepContainerVariants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.04, delayChildren: 0.04 } },
  // No staggerChildren on exit: every child's exit is latency before the next
  // step can mount, and staggering multiplies it.
  exit: {},
};

/** Heading row: free to travel, nothing inside it is interactive. */
const stepHeadingVariants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EXPO_OUT } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12, ease: EASE_IN } },
};

/**
 * Stage: the camera node. Opacity only — see the OPACITY AND preserve-3d note
 * above for why the fade cannot sit on the orbit node that carries the ring.
 */
const stepStageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.6, ease: EXPO_OUT } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: EASE_IN } },
};

/**
 * Orbit: the swept node, and the only thing that animates in the arc.
 *
 * `z` is held at -ARC_RADIUS in all three variants rather than being set once
 * in `style`. Both would render identically at rest, but a transform value
 * present in some variants and absent from others gets re-resolved toward the
 * variant that omits it on every re-render — the same failure mode the
 * pointerEvents note above describes. Stating it three times makes the ring
 * radius a constant of the node, not something the animation can drift.
 *
 * Under reduced motion the node emits no transform at all: the arc is the
 * ambient movement the setting exists to remove, and the stage's fade already
 * carries the step change on its own.
 */
const buildStepOrbitVariants = (reduceMotion: boolean) =>
  reduceMotion
    ? { initial: {}, animate: {}, exit: {} }
    : {
        initial: { rotateY: ARC_DEGREES, z: -ARC_RADIUS },
        animate: {
          rotateY: 0,
          z: -ARC_RADIUS,
          transition: { duration: 0.7, ease: EXPO_OUT },
        },
        exit: {
          rotateY: -ARC_DEGREES,
          z: -ARC_RADIUS,
          transition: { duration: 0.12, ease: EASE_IN },
        },
      };

/** Nav row: opacity only — the buttons must never move under the pointer. */
const stepItemVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.6, ease: EXPO_OUT } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: EASE_IN } },
};

interface SetupStep {
  id: string;
  title: string;
  description: string;
}

// FP-P1-01/FP-P1-02: Provider + Model verification and Workspace preflight are
// part of first-run setup. Setup can only declare Complete as "verified" after
// live credential/model checks and an explicit workspace+permission choice;
// Skip records status 'skipped' (limited mode).
const STEP = {
  WELCOME: 0,
  RUNTIME: 1,
  INSTALLING: 2,
  PROVIDER: 3,
  MODEL: 4,
  WORKSPACE: 5,
  COMPLETE: 6,
} as const;

const getSteps = (t: TFunction): SetupStep[] => [
  {
    id: 'welcome',
    title: t('steps.welcome.title'),
    description: t('steps.welcome.description'),
  },
  {
    id: 'runtime',
    title: t('steps.runtime.title'),
    description: t('steps.runtime.description'),
  },
  {
    id: 'installing',
    title: t('steps.installing.title'),
    description: t('steps.installing.description'),
  },
  {
    id: 'provider',
    title: t('steps.provider.title'),
    description: t('steps.provider.description'),
  },
  {
    id: 'model',
    title: t('steps.model.title'),
    description: t('steps.model.description'),
  },
  {
    id: 'workspace',
    title: t('steps.workspace.title'),
    description: t('steps.workspace.description'),
  },
  {
    id: 'complete',
    title: t('steps.complete.title'),
    description: t('steps.complete.description'),
  },
];

// Default skills to auto-install (no additional API keys required)
interface DefaultSkill {
  id: string;
  name: string;
  description: string;
}

const getDefaultSkills = (t: TFunction): DefaultSkill[] => [
  { id: 'opencode', name: t('defaultSkills.opencode.name'), description: t('defaultSkills.opencode.description') },
  { id: 'python-env', name: t('defaultSkills.python-env.name'), description: t('defaultSkills.python-env.description') },
  { id: 'code-assist', name: t('defaultSkills.code-assist.name'), description: t('defaultSkills.code-assist.description') },
  { id: 'file-tools', name: t('defaultSkills.file-tools.name'), description: t('defaultSkills.file-tools.description') },
  { id: 'terminal', name: t('defaultSkills.terminal.name'), description: t('defaultSkills.terminal.description') },
];

// NOTE: Channel types moved to Settings > Channels page
// NOTE: Skill bundles moved to Settings > Skills page - auto-install essential skills during setup

export function Setup() {
  const { t } = useTranslation(['setup', 'channels']);
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<number>(STEP.WELCOME);
  const currentStepRef = useRef<number>(STEP.WELCOME);
  const goToStep = useCallback((expected: number, next: number) => {
    if (currentStepRef.current !== expected) return;
    currentStepRef.current = next;
    setCurrentStep(next);
  }, []);
  const installationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (installationTimer.current) clearTimeout(installationTimer.current);
    installationTimer.current = null;
  }, [currentStep]);
  const reduceMotion = useReducedMotion() ?? false;
  const stepOrbitVariants = useMemo(() => buildStepOrbitVariants(reduceMotion), [reduceMotion]);

  // Setup state
  // Installation state for the Installing step
  const [installedSkills, setInstalledSkills] = useState<string[]>([]);
  // Runtime check status
  const [runtimeChecksPassed, setRuntimeChecksPassed] = useState(false);
  // FP-P1-01: provider/model verification state
  const [pendingProvider, setPendingProvider] = useState<PendingProviderSetup | null>(null);
  const [modelVerified, setModelVerified] = useState<{ model: string } | null>(null);
  // FP-P1-02: explicit workspace + permission choice
  const [workspaceConfirmed, setWorkspaceConfirmed] = useState<WorkspaceSetupOutcome | null>(null);

  const steps = getSteps(t);
  const safeStepIndex = Number.isInteger(currentStep)
    ? Math.min(Math.max(currentStep, STEP.WELCOME), steps.length - 1)
    : STEP.WELCOME;
  const step = steps[safeStepIndex] ?? steps[STEP.WELCOME];
  const isFirstStep = safeStepIndex === STEP.WELCOME;
  const isLastStep = safeStepIndex === steps.length - 1;

  const markSetupComplete = useSettingsStore((state) => state.markSetupComplete);
  const setSetupProviderVerification = useSettingsStore(
    (state) => state.setSetupProviderVerification,
  );
  const setupProviderVerification = useSettingsStore(
    (state) => state.setupProviderVerification,
  );

  // Derive canProceed based on current step - computed directly to avoid useEffect
  const canProceed = useMemo(() => {
    switch (safeStepIndex) {
      case STEP.WELCOME:
        return true;
      case STEP.RUNTIME:
        return runtimeChecksPassed;
      case STEP.INSTALLING:
        return false; // Cannot manually proceed, auto-proceeds when done
      case STEP.PROVIDER:
        return pendingProvider !== null;
      case STEP.MODEL:
        return modelVerified !== null;
      case STEP.WORKSPACE:
        return workspaceConfirmed !== null;
      case STEP.COMPLETE:
        return true;
      default:
        return true;
    }
  }, [safeStepIndex, runtimeChecksPassed, pendingProvider, modelVerified, workspaceConfirmed]);

  // Outgoing animated controls and installation results may arrive after navigation.
  // Step transitions check their origin; the terminal action also commits only once.
  const committedRef = useRef(false);

  const handleNext = async () => {
    if (currentStepRef.current !== safeStepIndex || !canProceed) return;
    if (isLastStep) {
      // FP-P1-01: Complete is only reachable as 'verified' (provider+model both
      // live-checked) or via the explicit Skip path which records 'skipped'.
      if (committedRef.current) return;
      committedRef.current = true;
      markSetupComplete();
      toast.success(t('complete.title'));
      navigate('/');
    } else {
      goToStep(safeStepIndex, safeStepIndex + 1);
    }
  };

  const handleBack = () => {
    goToStep(safeStepIndex, Math.max(safeStepIndex - 1, 0));
  };

  const handleSkip = () => {
    // FP-P1-01: skipping is allowed but never silently equivalent to verified.
    // The Complete page and the chat first-send gate both key off this state.
    if (committedRef.current) return;
    committedRef.current = true;
    if (!isSetupVerificationComplete(setupProviderVerification)) {
      setSetupProviderVerification({ status: 'skipped' });
    }
    markSetupComplete();
    navigate('/');
  };

  // Auto-proceed when installation is complete
  const handleInstallationComplete = useCallback((skills: string[]) => {
    if (currentStepRef.current !== STEP.INSTALLING) return;
    setInstalledSkills(skills);
    if (installationTimer.current) clearTimeout(installationTimer.current);
    installationTimer.current = setTimeout(() => {
      goToStep(STEP.INSTALLING, STEP.PROVIDER);
    }, 1000);
  }, [goToStep]);


  return (
    <div data-testid="setup-page" className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      {/* Cursor-lit grid. Fixed and at --z-base, so the content below needs to
       * be positioned to paint above it — non-positioned blocks render beneath
       * positioned siblings regardless of DOM order. */}
      <SetupGridBackdrop />
      {/* overflow-x-clip, not the default both-axis auto: the card now swings
        * ~337px sideways along the ring, which is real horizontal overflow. Left
        * on auto it raises a horizontal scrollbar mid-sweep, and the scrollbar
        * appearing steals height and reflows the step under the pointer. `clip`
        * rather than `hidden` because hidden would also make x a programmatic
        * scroll surface; we want the sweep masked, not scrollable. Clipping on
        * an ancestor is safe for the 3D chain — only preserve-3d on the node
        * itself is affected by grouping. */}
      <div className="relative z-raised flex-1 overflow-y-auto overflow-x-clip">
        {/* Progress Indicator */}
        <div className="flex justify-center pt-8">
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s.id} className="flex items-center">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors',
                    i < safeStepIndex
                      ? 'border-primary bg-primary text-primary-foreground'
                      : i === safeStepIndex
                        ? 'border-primary text-primary'
                        : 'border-muted-foreground/30 text-muted-foreground'
                  )}
                >
                  {i < safeStepIndex ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span className="text-sm">{i + 1}</span>
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div className="h-0.5 w-8 bg-muted-foreground/30">
                    {/* Fills left-to-right instead of swapping colour, so the
                      * progress rail gains a direction. */}
                    <motion.div
                      className="h-full w-full origin-left bg-primary"
                      initial={false}
                      animate={{ scaleX: i < safeStepIndex ? 1 : 0 }}
                      transition={{ duration: 0.5, ease: EXPO_OUT }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            variants={stepContainerVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="mx-auto max-w-2xl p-8"
          >
            <motion.div variants={stepHeadingVariants} className="text-center mb-8">
              <h1 className="text-xl font-serif font-normal tracking-tight mb-2">{t(`steps.${step.id}.title`)}</h1>
              <p className="text-muted-foreground">{t(`steps.${step.id}.description`)}</p>
            </motion.div>

            {/* Step-specific content, on the ring. Three nodes, because the
              * product translateZ(-r)·rotateY(θ)·translateZ(+r) cannot be
              * expressed on one — see THE ARC at the top of this file.
              *
              * `perspective` here is the CSS property, not framer's
              * `transformPerspective`. They are different things: the property
              * is the camera for this element's *children*, while
              * transformPerspective injects perspective() into the element's
              * *own* transform and leaves descendants untouched. Only the
              * former can project a parent/child 3D chain. */}
            <motion.div
              variants={stepStageVariants}
              style={reduceMotion ? undefined : { perspective: `${ARC_PERSPECTIVE}px` }}
              className={cn('mb-8', !reduceMotion && 'setup-arc-stage')}
            >
              <motion.div
                variants={stepOrbitVariants}
                className={cn(!reduceMotion && 'setup-arc-orbit')}
              >
                <div
                  data-testid="setup-step-card"
                  style={
                    reduceMotion
                      ? undefined
                      : ({ '--setup-arc-radius': `${ARC_RADIUS}px` } as CSSProperties)
                  }
                  className={cn(
                    'rounded-xl bg-card text-card-foreground border shadow-sm p-8',
                    !reduceMotion && 'setup-card-3d',
                  )}
                >
                  {safeStepIndex === STEP.WELCOME && <WelcomeContent />}
                  {safeStepIndex === STEP.RUNTIME && (
                    <RuntimeContent onStatusChange={setRuntimeChecksPassed} />
                  )}
                  {safeStepIndex === STEP.INSTALLING && (
                    <InstallingContent
                      skills={getDefaultSkills(t)}
                      onComplete={handleInstallationComplete}
                      onSkip={() => goToStep(STEP.INSTALLING, STEP.PROVIDER)}
                    />
                  )}
                  {safeStepIndex === STEP.PROVIDER && (
                    <ProviderStepContent
                      pending={pendingProvider}
                      onValidated={(pending) => {
                        setPendingProvider(pending);
                        if (!pending) setModelVerified(null);
                      }}
                    />
                  )}
                  {safeStepIndex === STEP.MODEL && (
                    <ModelStepContent pending={pendingProvider} onVerified={setModelVerified} />
                  )}
                  {safeStepIndex === STEP.WORKSPACE && (
                    <WorkspaceStepContent
                      confirmed={workspaceConfirmed}
                      onConfirmed={setWorkspaceConfirmed}
                    />
                  )}
                  {safeStepIndex === STEP.COMPLETE && (
                    <CompleteContent
                      installedSkills={installedSkills}
                      workspace={workspaceConfirmed}
                    />
                  )}
                </div>
              </motion.div>
            </motion.div>

            {/* Navigation - hidden during installation step */}
            {safeStepIndex !== STEP.INSTALLING && (
              <motion.div variants={stepItemVariants} className="flex justify-between">
                <div>
                  {!isFirstStep && (
                    <SetupActionButton
                      variant="ghost"
                      frame
                      onClick={handleBack}
                      label={t('nav.back')}
                      iconBefore={<ChevronLeft className="h-4 w-4 mr-2" />}
                    />
                  )}
                </div>
                <div className="flex gap-2">
                  {!isLastStep && safeStepIndex !== STEP.RUNTIME && (
                    <SetupActionButton
                      data-testid="setup-skip-button"
                      variant="ghost"
                      frame
                      onClick={handleSkip}
                      label={t('nav.skipSetup')}
                    />
                  )}
                  {/* No frame: this variant is filled, and a ring drawn on the
                    * fill reads as an artefact rather than an affordance. */}
                  <SetupActionButton
                    data-testid="setup-next-button"
                    onClick={handleNext}
                    disabled={!canProceed}
                    label={isLastStep ? t('nav.getStarted') : t('nav.next')}
                    iconAfter={isLastStep ? undefined : <ChevronRight className="h-4 w-4 ml-2" />}
                  />
                </div>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== Step Content Components ====================

function WelcomeContent() {
  const { t } = useTranslation(['setup', 'settings']);
  const { language, setLanguage } = useSettingsStore();

  return (
    <div data-testid="setup-welcome-step" className="text-center space-y-4">
      <div className="mb-4 flex justify-center">
        <BrandLogo size="setup" />
      </div>
      <h2 className="text-xl font-serif font-normal tracking-tight">{t('welcome.title')}</h2>
      <p className="text-muted-foreground">
        {t('welcome.description')}
      </p>

      {/* Language Selector */}
      <div className="flex justify-center gap-2 py-2">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <Button
            key={lang.code}
            variant={language === lang.code ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setLanguage(lang.code)}
            className={cn(
              'h-7 text-xs',
              language === lang.code
                ? 'bg-black/5 dark:bg-white/10 text-foreground'
                : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5',
            )}
          >
            {lang.label}
          </Button>
        ))}
      </div>

      <ul className="text-left space-y-2 text-muted-foreground pt-2">
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
          {t('welcome.features.noCommand')}
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
          {t('welcome.features.modernUI')}
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
          {t('welcome.features.bundles')}
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
          {t('welcome.features.crossPlatform')}
        </li>
      </ul>
    </div>
  );
}

interface RuntimeContentProps {
  onStatusChange: (canProceed: boolean) => void;
}

function RuntimeContent({ onStatusChange }: RuntimeContentProps) {
  const { t } = useTranslation('setup');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const startGateway = useGatewayStore((state) => state.start);

  const [checks, setChecks] = useState({
    nodejs: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
    openclaw: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
    gateway: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
  });
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [openclawDir, setOpenclawDir] = useState('');
  const gatewayTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const runChecks = useCallback(async () => {
    // Reset checks
    setChecks({
      nodejs: { status: 'checking', message: '' },
      openclaw: { status: 'checking', message: '' },
      gateway: { status: 'checking', message: '' },
    });

    // Check Node.js — always available in Electron
    setChecks((prev) => ({
      ...prev,
      nodejs: { status: 'success', message: t('runtime.status.success') },
    }));

    // Check OpenClaw package status
    try {
      const openclawStatus = await hostApi.openclaw.status();

      setOpenclawDir(openclawStatus.dir);

      if (!openclawStatus.packageExists) {
        setChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'error',
            message: `OpenClaw package not found at: ${openclawStatus.dir}`
          },
        }));
      } else if (!openclawStatus.isBuilt) {
        setChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'error',
            message: 'OpenClaw package found but dist is missing'
          },
        }));
      } else {
        const versionLabel = openclawStatus.version ? ` v${openclawStatus.version}` : '';
        setChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'success',
            message: `OpenClaw package ready${versionLabel}`
          },
        }));
      }
    } catch (error) {
      setChecks((prev) => ({
        ...prev,
        openclaw: { status: 'error', message: `Check failed: ${error}` },
      }));
    }

    // Check Gateway — read directly from store to avoid stale closure
    // Don't immediately report error; gateway may still be initializing
    const currentGateway = useGatewayStore.getState().status;
    if (currentGateway.state === 'running') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'success', message: `Running on port ${currentGateway.port}` },
      }));
    } else if (currentGateway.state === 'error') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: currentGateway.error || t('runtime.status.error') },
      }));
    } else if (currentGateway.state === 'stopped') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: t('runtime.status.gatewayStopped') },
      }));
    } else {
      setChecks((prev) => ({
        ...prev,
        gateway: {
          status: 'checking',
          message: t('runtime.status.gatewayStarting'),
        },
      }));
    }
  }, [t]);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  // Update canProceed when gateway status changes
  useEffect(() => {
    const allPassed = checks.nodejs.status === 'success'
      && checks.openclaw.status === 'success'
      && (checks.gateway.status === 'success' || gatewayStatus.state === 'running');
    onStatusChange(allPassed);
  }, [checks, gatewayStatus, onStatusChange]);

  // Update gateway check when gateway status changes
  useEffect(() => {
    if (gatewayStatus.state === 'running') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'success', message: t('runtime.status.gatewayRunning', { port: gatewayStatus.port }) },
      }));
    } else if (gatewayStatus.state === 'error') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: gatewayStatus.error || 'Failed to start' },
      }));
    } else if (gatewayStatus.state === 'stopped') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: t('runtime.status.gatewayStopped') },
      }));
    } else if (gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'checking', message: t('runtime.status.gatewayStarting') },
      }));
    }
  }, [gatewayStatus, t]);

  // Gateway startup timeout — show error only after giving enough time to initialize
  useEffect(() => {
    if (gatewayTimeoutRef.current) {
      clearTimeout(gatewayTimeoutRef.current);
      gatewayTimeoutRef.current = null;
    }

    // If gateway is already in a terminal state, no timeout needed
    if (gatewayStatus.state === 'running' || gatewayStatus.state === 'error') {
      return;
    }

    // Set timeout for non-terminal states (stopped, starting, reconnecting)
    gatewayTimeoutRef.current = setTimeout(() => {
      setChecks((prev) => {
        if (prev.gateway.status === 'checking') {
          return {
            ...prev,
            gateway: { status: 'error', message: 'Gateway startup timed out' },
          };
        }
        return prev;
      });
    }, 600 * 1000); // 600 seconds — enough for gateway to fully initialize

    return () => {
      if (gatewayTimeoutRef.current) {
        clearTimeout(gatewayTimeoutRef.current);
        gatewayTimeoutRef.current = null;
      }
    };
  }, [gatewayStatus.state]);

  const handleStartGateway = async () => {
    setChecks((prev) => ({
      ...prev,
      gateway: { status: 'checking', message: 'Starting...' },
    }));
    await startGateway();
  };

  const handleShowLogs = async () => {
    try {
      const logs = await hostApi.logs.recent(100);
      setLogContent(logs.content);
      setShowLogs(true);
    } catch {
      setLogContent('(Failed to load logs)');
      setShowLogs(true);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      const { dir: logDir } = await hostApi.logs.dir();
      if (logDir) {
        await hostApi.shell.showItemInFolder(logDir);
      }
    } catch {
      // ignore
    }
  };

  const ERROR_TRUNCATE_LEN = 30;

  const renderStatus = (status: 'checking' | 'success' | 'error', message: string) => {
    if (status === 'checking') {
      return (
        <span className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400 whitespace-nowrap">
          <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
          {message || 'Checking...'}
        </span>
      );
    }
    if (status === 'success') {
      return (
        <span className="flex items-center gap-2 text-green-700 dark:text-green-400 whitespace-nowrap">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
          {message}
        </span>
      );
    }

    const isLong = message.length > ERROR_TRUNCATE_LEN;
    const displayMsg = isLong ? message.slice(0, ERROR_TRUNCATE_LEN) : message;

    return (
      <span className="flex items-center gap-2 text-red-700 dark:text-red-400 whitespace-nowrap">
        <XCircle className="h-5 w-5 flex-shrink-0" />
        <span>{displayMsg}</span>
        {isLong && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-pointer text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 font-medium">...</span>
            </TooltipTrigger>
            <TooltipContent>{message}</TooltipContent>
          </Tooltip>
        )}
      </span>
    );
  };

  return (
    <div data-testid="setup-runtime-step" className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-serif font-normal tracking-tight">{t('runtime.title')}</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleShowLogs}>
            {t('runtime.viewLogs')}
          </Button>
          <Button variant="ghost" size="sm" onClick={runChecks}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('runtime.recheck')}
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 rounded-lg bg-surface-input/50">
          <span className="text-left">{t('runtime.nodejs')}</span>
          <div className="flex justify-end">
            {renderStatus(checks.nodejs.status, checks.nodejs.message)}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 rounded-lg bg-surface-input/50">
          <div className="text-left min-w-0">
            <span>{t('runtime.openclaw')}</span>
            {openclawDir && (
              <p className="text-xs text-muted-foreground mt-0.5 font-mono break-all">
                {openclawDir}
              </p>
            )}
          </div>
          <div className="flex justify-end self-start mt-0.5">
            {renderStatus(checks.openclaw.status, checks.openclaw.message)}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 rounded-lg bg-surface-input/50">
          <div className="flex items-center gap-2 text-left">
            <span>{t('runtime.gateway')}</span>
            {checks.gateway.status === 'error' && (
              <Button
                data-testid="setup-runtime-start-gateway"
                variant="outline"
                size="sm"
                onClick={handleStartGateway}
              >
                {t('runtime.startGateway')}
              </Button>
            )}
          </div>
          <div data-testid="setup-runtime-gateway-status" className="flex justify-end">
            {renderStatus(checks.gateway.status, checks.gateway.message)}
          </div>
        </div>
      </div>

      {(checks.nodejs.status === 'error' || checks.openclaw.status === 'error') && (
        <div className="mt-4 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-700 dark:text-red-400 mt-0.5" />
            <div>
              <p className="font-medium text-red-700 dark:text-red-400">{t('runtime.issue.title')}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t('runtime.issue.desc')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Log viewer panel */}
      {showLogs && (
        <div className="mt-4 p-4 rounded-lg bg-black/40 border border-border">
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-foreground text-sm">{t('runtime.logs.title')}</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleOpenLogDir}>
                <ExternalLink className="h-3 w-3 mr-1" />
                {t('runtime.logs.openFolder')}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowLogs(false)}>
                {t('runtime.logs.close')}
              </Button>
            </div>
          </div>
          <pre className="text-xs text-foreground/80 bg-black/5 dark:bg-white/10 p-3 rounded max-h-60 overflow-auto whitespace-pre-wrap font-mono">
            {logContent || t('runtime.logs.noLogs')}
          </pre>
        </div>
      )}
    </div>
  );
}

// NOTE: ProviderContent component removed - configure providers via Settings > AI Providers


// Installation status for each skill
type InstallStatus = 'pending' | 'installing' | 'completed' | 'failed';

interface SkillInstallState {
  id: string;
  name: string;
  description: string;
  status: InstallStatus;
}

interface InstallingContentProps {
  skills: DefaultSkill[];
  onComplete: (installedSkills: string[]) => void;
  onSkip: () => void;
}

function InstallingContent({ skills, onComplete, onSkip }: InstallingContentProps) {
  const { t } = useTranslation('setup');
  const [skillStates, setSkillStates] = useState<SkillInstallState[]>(
    skills.map((s) => ({ ...s, status: 'pending' as InstallStatus }))
  );
  const [overallProgress, setOverallProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const installStarted = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Real installation process
  useEffect(() => {
    if (installStarted.current) return;
    installStarted.current = true;

    const runRealInstall = async () => {
      try {
        // Step 1: Initialize all skills to 'installing' state for UI
        setSkillStates(prev => prev.map(s => ({ ...s, status: 'installing' })));
        setOverallProgress(10);

        // Step 2: Call the backend to install uv and setup Python
        const result = await hostApi.uv.installAll();
        if (!mounted.current) return;

        if (result.success) {
          setSkillStates(prev => prev.map(s => ({ ...s, status: 'completed' })));
          setOverallProgress(100);

          await new Promise((resolve) => setTimeout(resolve, 800));
          if (mounted.current) onComplete(skills.map(s => s.id));
        } else {
          setSkillStates(prev => prev.map(s => ({ ...s, status: 'failed' })));
          setErrorMessage(result.error || 'Unknown error during installation');
          toast.error('Environment setup failed');
        }
      } catch (err) {
        if (!mounted.current) return;
        setSkillStates(prev => prev.map(s => ({ ...s, status: 'failed' })));
        setErrorMessage(String(err));
        toast.error('Installation error');
      }
    };

    runRealInstall();
  }, [skills, onComplete]);

  const getStatusIcon = (status: InstallStatus) => {
    switch (status) {
      case 'pending':
        return <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />;
      case 'installing':
        return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-700 dark:text-green-400" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-700 dark:text-red-400" />;
    }
  };

  const getStatusText = (skill: SkillInstallState) => {
    switch (skill.status) {
      case 'pending':
        return <span className="text-muted-foreground">{t('installing.status.pending')}</span>;
      case 'installing':
        return <span className="text-primary">{t('installing.status.installing')}</span>;
      case 'completed':
        return <span className="text-green-700 dark:text-green-400">{t('installing.status.installed')}</span>;
      case 'failed':
        return <span className="text-red-700 dark:text-red-400">{t('installing.status.failed')}</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-4xl mb-4">⚙️</div>
        <h2 className="text-xl font-serif font-normal tracking-tight mb-2">{t('installing.title')}</h2>
        <p className="text-muted-foreground">
          {t('installing.subtitle')}
        </p>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t('installing.progress')}</span>
          <span className="text-primary">{overallProgress}%</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Skill list */}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {skillStates.map((skill) => (
          <motion.div
            key={skill.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'flex items-center justify-between p-3 rounded-lg',
              skill.status === 'installing' ? 'bg-surface-input' : 'bg-surface-input/50'
            )}
          >
            <div className="flex items-center gap-3">
              {getStatusIcon(skill.status)}
              <div>
                <p className="font-medium">{skill.name}</p>
                <p className="text-xs text-muted-foreground">{skill.description}</p>
              </div>
            </div>
            {getStatusText(skill)}
          </motion.div>
        ))}
      </div>

      {/* Error Message Display */}
      {errorMessage && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-sm"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-700 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">{t('installing.error')}</p>
              <pre className="text-xs bg-black/5 dark:bg-white/5 p-2 rounded overflow-x-auto whitespace-pre-wrap font-mono">
                {errorMessage}
              </pre>
              <Button
                variant="link"
                className="text-red-700 dark:text-red-400 p-0 h-auto text-xs underline"
                onClick={() => window.location.reload()}
              >
                {t('installing.restart')}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {!errorMessage && (
        <p className="text-sm text-muted-foreground text-center">
          {t('installing.wait')}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          data-testid="setup-installing-skip"
          variant="ghost"
          className="text-muted-foreground"
          onClick={onSkip}
        >
          {t('installing.skip')}
        </Button>
      </div>
    </div>
  );
}
interface CompleteContentProps {
  installedSkills: string[];
  workspace?: WorkspaceSetupOutcome | null;
}

function CompleteContent({ installedSkills, workspace }: CompleteContentProps) {
  const { t } = useTranslation(['setup', 'settings']);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const setupProviderVerification = useSettingsStore(
    (state) => state.setupProviderVerification,
  );
  const verified = isSetupVerificationComplete(setupProviderVerification);

  const installedSkillNames = getDefaultSkills(t)
    .filter((s: DefaultSkill) => installedSkills.includes(s.id))
    .map((s: DefaultSkill) => s.name)
    .join(', ');

  return (
    <div className="text-center space-y-6">
      <SetupCompleteMark />
      <h2 className="text-xl font-serif font-normal tracking-tight">{t('complete.title')}</h2>
      <p className="text-muted-foreground">
        {t('complete.subtitle')}
      </p>

      {/* FP-P1-01: never present a skipped setup as a working one. */}
      {!verified && (
        <div
          data-testid="setup-complete-unverified"
          className="mx-auto max-w-md rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-left"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 text-yellow-700 dark:text-yellow-400" />
            <div>
              <p className="font-medium text-yellow-800 dark:text-yellow-300">
                {t('complete.limitedMode.title')}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('complete.limitedMode.desc')}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3 text-left max-w-md mx-auto">
        <div className="flex items-center justify-between p-3 rounded-lg bg-surface-input/50">
          <span>{t('complete.components')}</span>
          <span className="text-green-700 dark:text-green-400">
            {installedSkillNames || `${installedSkills.length} ${t('installing.status.installed')}`}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-surface-input/50">
          <span>{t('complete.provider')}</span>
          {verified ? (
            <span
              data-testid="setup-complete-provider-verified"
              className="text-green-700 dark:text-green-400"
            >
              ✓ {setupProviderVerification.vendorId} · {setupProviderVerification.model}
            </span>
          ) : (
            <span className="text-yellow-700 dark:text-yellow-400">
              {t('complete.providerUnverified')}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-surface-input/50">
          <span>{t('complete.workspace')}</span>
          {workspace ? (
            <span
              data-testid="setup-complete-workspace"
              className="max-w-[240px] truncate text-green-700 dark:text-green-400"
              title={workspace.rootPath}
            >
              ✓ {workspace.rootPath} · {t(`workspace.modes.${workspace.permissionMode}.title`)}
            </span>
          ) : (
            <span className="text-yellow-700 dark:text-yellow-400">
              {t('complete.workspaceUnset')}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-surface-input/50">
          <span>{t('complete.gateway')}</span>
          <span className={gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false ? 'text-green-700 dark:text-green-400' : gatewayStatus.state === 'running' ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'}>
            {gatewayStatus.state === 'running'
              ? gatewayStatus.gatewayReady !== false
                ? `✓ ${t('complete.running')}`
                : 'starting'
              : gatewayStatus.state}
          </span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {t('complete.footer')}
      </p>
    </div>
  );
}

export default Setup;
