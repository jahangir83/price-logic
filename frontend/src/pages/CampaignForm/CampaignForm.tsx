import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Card,
  Checkbox,
  ChoiceList,
  FormLayout,
  InlineGrid,
  Layout,
  Modal,
  Page,
  Select,
  SkeletonBodyText,
  SkeletonDisplayText,
  Tag,
  TextField,
  Text,
  InlineStack,
} from '@shopify/polaris';
import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
  CampaignStatus,
  instantFromLocal,
} from '@pricelogic/shared';
import { ApiError } from '../../api/client';
import {
  activateCampaign,
  changeCampaignStatus,
  createCampaign,
  deactivateCampaign,
  getCampaign,
  listTargets,
  updateCampaign,
  type CampaignDetail,
} from '../../api/campaigns';
import { formatInZone, nowInZone, timezoneOptions } from '../../lib/timezones';
import { useFormState } from '../../hooks/useFormState';
import { CampaignPreview } from '../CampaignPreview/CampaignPreview';
import { SummaryPanel } from './SummaryPanel';
import { TargetingSection } from './TargetingSection';
import {
  emptyCampaignForm,
  fromCampaign,
  toRequest,
  validateForm,
  validateSchedule,
  type CampaignFormState,
  type ScheduleMode,
} from './campaignFormState';

interface CampaignFormProps {
  currency?: string;
  /** Given, the form edits that campaign instead of creating a new one. */
  campaignId?: string;
  /** Given, a new campaign is pre-filled from this one. */
  copyFromId?: string;
  onSaved?: (campaignId: string) => void;
  /** Open a copy of this campaign as a new draft. */
  onDuplicate?: (campaignId: string) => void;
  /** Go to the results screen — only reachable once a campaign has run. */
  onViewResults?: (campaignId: string) => void;
}

/** Statuses whose configuration may still be changed. Mirrors the server. */
const EDITABLE = [CampaignStatus.DRAFT, CampaignStatus.SCHEDULED];

const STATUS_TONE: Partial<
  Record<CampaignStatus, 'success' | 'info' | 'critical' | 'attention'>
> = {
  [CampaignStatus.ACTIVE]: 'success',
  [CampaignStatus.SCHEDULED]: 'info',
  [CampaignStatus.FAILED]: 'critical',
  [CampaignStatus.COMPLETED]: 'info',
};

/**
 * The campaign builder, and the campaign editor — the same screen.
 *
 * A merchant who has just saved a draft and one who opened it a day later are
 * looking at the same thing and want the same controls, so this is one
 * component rather than a create form and a separate read-only detail page. It
 * is also why the preview lives in a modal here: it answers "what will this
 * do", which is a question asked *while* editing, not a place you navigate to
 * and lose your changes getting back from.
 *
 * A new campaign saves as DRAFT. Activating is separate and explicit — filling
 * in a form is not a decision to change every price in the store.
 */
export function CampaignForm({
  currency = 'USD',
  campaignId,
  copyFromId,
  onSaved,
  onDuplicate,
  onViewResults,
}: CampaignFormProps) {
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(campaignId ?? copyFromId));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState<
    'draft' | 'activate' | 'schedule' | null
  >(null);
  const [saved, setSaved] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState<'activate' | 'deactivate' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editing = Boolean(campaignId);
  const readOnly = campaign !== null && !EDITABLE.includes(campaign.status);

  /*
   * The end date stays editable on a running campaign. It is the one setting
   * that does not rewrite what has already been applied — every other field
   * would leave `price_changes` describing a campaign that never ran.
   */
  const formState = useFormState<CampaignFormState>(emptyCampaignForm(), {
    readOnly,
    editableWhenReadOnly: ['hasEndDate', 'endAt'],
  });
  const form = formState.state;

  /*
   * Load the campaign and its targets together: the form cannot be shown
   * half-populated, because a merchant seeing an empty include list would
   * reasonably conclude the campaign targets everything and save that.
   */
  useEffect(() => {
    const sourceId = campaignId ?? copyFromId;
    if (!sourceId) return;
    let cancelled = false;

    /*
     * No `setLoading(true)` here: the initial state already accounts for
     * whether there is something to load, and the routes key this component by
     * id so a different campaign remounts rather than reusing this one. Setting
     * it synchronously in the effect body would only add a cascading render.
     */
    Promise.all([getCampaign(sourceId), listTargets(sourceId)])
      .then(([detail, targets]) => {
        if (cancelled) return;
        const hydrated = fromCampaign(detail, targets.targets);

        if (campaignId) {
          setCampaign(detail);
          // `reset`, not `set`: what was just loaded is the clean baseline, so
          // opening a campaign must not show the save bar as though the
          // merchant had already edited something.
          formState.reset(hydrated);
        } else {
          /*
           * A duplicate is a *new* campaign: it keeps the settings and drops
           * everything belonging to the original run — its identity, its
           * status, and its schedule, which has very likely already passed.
           * It starts immediately unless the merchant says otherwise.
           */
          formState.reset({
            ...hydrated,
            title: `${hydrated.title} (copy)`,
            scheduleMode: 'IMMEDIATELY',
            startAt: nowInZone(hydrated.timezone),
            hasEndDate: false,
            endAt: '',
          });
        }
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Could not open that campaign.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `reset` is stable enough: it changes only when the baseline does, which
    // is exactly when a reload should not be re-triggered anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, copyFromId]);

  const patch = useCallback(
    (changes: Partial<CampaignFormState>) => {
      formState.set(changes);
      setSaved(false);
    },
    [formState],
  );

  /*
   * Rebuilt when the zone changes, because the labels carry each zone's
   * *current* offset — a list built in January reads an hour wrong in June for
   * half the world.
   */
  const zoneOptions = useMemo(
    () => timezoneOptions(form.timezone),
    [form.timezone],
  );

  const scheduleError = useMemo(() => validateSchedule(form), [form]);

  /** What the chosen wall-clock time actually resolves to, spelled out. */
  const startsAtHint = useMemo(() => {
    if (form.scheduleMode !== 'SCHEDULE' || !form.startAt) return null;
    try {
      const instant = instantFromLocal(form.startAt, form.timezone);
      return `Starts ${formatInZone(instant, form.timezone)} (${form.timezone}).`;
    } catch {
      return null;
    }
  }, [form.scheduleMode, form.startAt, form.timezone]);

  const endsAtHint = useMemo(() => {
    if (!form.hasEndDate || !form.endAt) return null;
    try {
      const instant = instantFromLocal(form.endAt, form.timezone);
      return `Ends ${formatInZone(instant, form.timezone)} (${form.timezone}). Every price it changed goes back then.`;
    } catch {
      return null;
    }
  }, [form.hasEndDate, form.endAt, form.timezone]);

  /**
   * Save, and optionally decide what happens next.
   *
   * Three outcomes from one form, because they differ only in what follows the
   * write:
   *
   * - **draft** — saved and nothing else. The campaign sits there.
   * - **activate** — saved, then queued to run now.
   * - **schedule** — saved, then moved to SCHEDULED so the sweeper starts it
   *   when its start time arrives.
   *
   * Activation is never implied by saving. A merchant editing a title has not
   * asked to change every price in their store.
   */
  const save = useCallback(
    async (intent: 'draft' | 'activate' | 'schedule' = 'draft') => {
      const problem = validateForm(form);
      if (problem) {
        setError(problem);
        return;
      }

      setSaving(intent);
      setError(null);
      setFieldErrors({});
      try {
        const body = toRequest(form);
        const result = campaignId
          ? await updateCampaign(campaignId, body)
          : await createCampaign(body);

        if (intent === 'activate') {
          await activateCampaign(result.id);
          setNotice(
            'The campaign is starting. Prices update in the background.',
          );
        } else if (intent === 'schedule') {
          await changeCampaignStatus(result.id, CampaignStatus.SCHEDULED);
          setNotice(
            startsAtHint
              ? `Scheduled. ${startsAtHint}`
              : 'Scheduled. It will start itself at the time you chose.',
          );
        } else {
          setSaved(true);
        }

        // What was just saved is the new clean baseline, so Discard stops
        // offering to undo edits that are already stored.
        formState.markClean();

        // Re-read rather than trust the write: activate and schedule both
        // change the status after the save, and the badge and the available
        // actions are driven by it.
        if (campaignId) setCampaign(await getCampaign(campaignId));
        onSaved?.(result.id);
      } catch (cause) {
        if (cause instanceof ApiError) {
          setError(cause.message);
          setFieldErrors(cause.fieldErrors);
        } else {
          setError('Could not save the campaign.');
        }
      } finally {
        setSaving(null);
      }
    },
    [campaignId, form, formState, onSaved, startsAtHint],
  );

  /**
   * Start or end the campaign.
   *
   * Both queue a job rather than doing the work, so the answer here is "it has
   * started", not "it is done". The campaign is re-read afterwards so the badge
   * and the available actions reflect the new status without a page reload.
   */
  const runLifecycle = useCallback(
    async (action: 'activate' | 'deactivate') => {
      if (!campaignId) return;
      setBusy(action);
      setError(null);
      try {
        await (action === 'activate'
          ? activateCampaign(campaignId)
          : deactivateCampaign(campaignId));
        setNotice(
          action === 'activate'
            ? 'The campaign is starting. Prices update in the background — the results screen shows progress.'
            : 'The campaign is ending. Every price it changed is being put back.',
        );
        setCampaign(await getCampaign(campaignId));
      } catch (cause) {
        setError(
          cause instanceof ApiError
            ? cause.message
            : `Could not ${action} the campaign.`,
        );
      } finally {
        setBusy(null);
      }
    },
    [campaignId],
  );

  const fieldError = (field: string): string | undefined =>
    fieldErrors[field]?.[0];

  if (loading) {
    return (
      <Page title="Campaign">
        <Card>
          <BlockStack gap="400">
            <SkeletonDisplayText size="small" />
            <SkeletonBodyText lines={8} />
          </BlockStack>
        </Card>
      </Page>
    );
  }

  // A campaign that could not be loaded has no form to show — offering empty
  // fields would invite the merchant to overwrite it with blanks.
  if (editing && !campaign) {
    return (
      <Page title="Campaign">
        <Banner tone="critical" title="Could not open that campaign">
          <Text as="p">{error ?? 'It may have been deleted.'}</Text>
        </Banner>
      </Page>
    );
  }

  /*
   * Which lifecycle action is offered is the server's decision, not this
   * screen's: `allowedTransitions` comes from the same state machine that will
   * reject an illegal one. Deriving it from the status here would be a second
   * copy of those rules, free to drift.
   */
  const canActivate = campaign?.allowedTransitions.includes(
    CampaignStatus.ACTIVE,
  );
  const canDeactivate =
    campaign?.status === CampaignStatus.ACTIVE ||
    campaign?.status === CampaignStatus.SCHEDULED;

  const secondaryActions = [
    // Only offered once there is a saved campaign to preview — the endpoint
    // prices what is stored, not what is on screen.
    ...(campaignId
      ? [{ content: 'Preview', onAction: () => setPreviewOpen(true) }]
      : []),
    ...(campaignId && canActivate
      ? [
          {
            // "Reactivate" for a campaign that has already run once — the same
            // request either way, but the word tells the merchant which of the
            // two situations they are in.
            content: hasRun(campaign?.status ?? CampaignStatus.DRAFT)
              ? 'Reactivate'
              : 'Activate',
            onAction: () => void runLifecycle('activate'),
            loading: busy === 'activate',
          },
        ]
      : []),
    ...(campaignId && canDeactivate
      ? [
          {
            content: 'Deactivate',
            // Destructive in the Polaris sense: it puts every price back, and
            // a merchant reaching for it by accident undoes a live sale.
            destructive: true,
            onAction: () => void runLifecycle('deactivate'),
            loading: busy === 'deactivate',
          },
        ]
      : []),
    ...(campaignId && onDuplicate
      ? [{ content: 'Duplicate', onAction: () => onDuplicate(campaignId) }]
      : []),
    ...(campaignId && onViewResults && campaign && hasRun(campaign.status)
      ? [{ content: 'Results', onAction: () => onViewResults(campaignId) }]
      : []),
  ];

  return (
    <Page
      title={editing ? (campaign?.title ?? 'Campaign') : 'New campaign'}
      titleMetadata={
        campaign ? (
          <Badge tone={STATUS_TONE[campaign.status]}>{campaign.status}</Badge>
        ) : undefined
      }
      /*
       * The primary action is what the merchant just told us they want. Having
       * chosen "schedule for later", the obvious button is Schedule — not Save,
       * which would leave a draft that never runs and looks like it will.
       */
      primaryAction={
        readOnly
          ? undefined
          : form.scheduleMode === 'SCHEDULE'
            ? {
                content: 'Save and schedule',
                onAction: () => void save('schedule'),
                loading: saving === 'schedule',
                disabled: saving !== null || scheduleError !== null,
              }
            : {
                content: 'Save and activate',
                onAction: () => void save('activate'),
                loading: saving === 'activate',
                disabled: saving !== null || scheduleError !== null,
              }
      }
      secondaryActions={
        readOnly
          ? secondaryActions
          : [
              {
                content: 'Save as draft',
                onAction: () => void save('draft'),
                loading: saving === 'draft',
                disabled: saving !== null,
              },
              // Only offered once there is something to discard — an always-on
              // Discard on an untouched form invites a merchant to press it and
              // wonder what it just undid.
              ...(formState.isDirty
                ? [
                    {
                      content: 'Discard',
                      onAction: () => {
                        formState.reset();
                        setError(null);
                        setSaved(false);
                      },
                      disabled: saving !== null,
                    },
                  ]
                : []),
              ...secondaryActions,
            ]
      }
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {error ? (
              <Banner tone="critical" title="Check the campaign">
                <Text as="p">{error}</Text>
              </Banner>
            ) : null}

            {saved && !error ? (
              <Banner tone="success" title="Saved" onDismiss={() => setSaved(false)} />
            ) : null}

            {notice ? (
              <Banner tone="info" onDismiss={() => setNotice(null)}>
                <Text as="p">{notice}</Text>
              </Banner>
            ) : null}

            {readOnly ? (
              /*
               * Shown rather than silently disabling the fields. The rule is
               * not arbitrary: `price_changes` records what a run actually did,
               * and editing the configuration under a campaign that has run
               * would leave that record describing something that never
               * happened — which is exactly what revert replays.
               */
              <Banner tone="info" title={`This campaign is ${campaign?.status.toLowerCase()}`}>
                <Text as="p">
                  Its settings are shown as they were saved and cannot be
                  changed while it is in this state. Duplicate it to build a new
                  one from the same settings.
                </Text>
              </Banner>
            ) : null}

            {/*
              A native fieldset disables every control inside it, which is one
              declaration instead of a `disabled` prop on twenty fields and,
              more to the point, cannot be forgotten when a field is added.
              The reset keeps it invisible — a fieldset draws a border and
              carries margins by default.
            */}
            <fieldset
              disabled={readOnly}
              style={{
                border: 0,
                padding: 0,
                margin: 0,
                // Without this a fieldset refuses to shrink below its content.
                minInlineSize: 0,
              }}
            >
              <BlockStack gap="400">
            <Card>
              <FormLayout>
                <TextField
                  label="Campaign name"
                  value={form.title}
                  onChange={(title) => patch({ title })}
                  autoComplete="off"
                  error={fieldError('title')}
                  helpText="Only you see this — it does not appear on the storefront."
                />
              </FormLayout>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Price change
                </Text>

                <Checkbox
                  label="Change prices"
                  helpText="Turn this off to only add or remove tags."
                  checked={form.adjustmentEnabled}
                  onChange={(adjustmentEnabled) => patch({ adjustmentEnabled })}
                />

                {form.adjustmentEnabled ? (
                  <FormLayout>
                    <FormLayout.Group>
                      <Select
                        label="Direction"
                        options={[
                          {
                            label: 'Decrease',
                            value: CampaignAdjustmentDirection.DECREASE,
                          },
                          {
                            label: 'Increase',
                            value: CampaignAdjustmentDirection.INCREASE,
                          },
                        ]}
                        value={form.adjustmentDirection}
                        onChange={(value) =>
                          patch({
                            adjustmentDirection:
                              value as CampaignAdjustmentDirection,
                          })
                        }
                      />
                      <Select
                        label="By"
                        options={[
                          {
                            label: 'Percentage',
                            value: CampaignAdjustmentUnit.PERCENTAGE,
                          },
                          {
                            label: 'Fixed amount',
                            value: CampaignAdjustmentUnit.FIXED_AMOUNT,
                          },
                        ]}
                        value={form.adjustmentUnit}
                        onChange={(value) =>
                          patch({
                            adjustmentUnit: value as CampaignAdjustmentUnit,
                          })
                        }
                      />
                      <TextField
                        label="Amount"
                        value={form.adjustmentValue}
                        onChange={(adjustmentValue) => patch({ adjustmentValue })}
                        autoComplete="off"
                        inputMode="decimal"
                        suffix={
                          form.adjustmentUnit ===
                          CampaignAdjustmentUnit.PERCENTAGE
                            ? '%'
                            : currency
                        }
                        error={fieldError('adjustmentValue')}
                      />
                    </FormLayout.Group>

                    <Select
                      label="Calculate from"
                      options={[
                        { label: 'Current price', value: CampaignBasis.PRICE },
                        {
                          label: 'Compare-at price',
                          value: CampaignBasis.COMPARE_AT_PRICE,
                        },
                      ]}
                      value={form.basis}
                      onChange={(value) =>
                        patch({ basis: value as CampaignBasis })
                      }
                      helpText="Compare-at is useful for discounting from the original price rather than a price already on sale."
                    />
                  </FormLayout>
                ) : null}

                <Checkbox
                  label="Round prices"
                  checked={form.roundingEnabled}
                  onChange={(roundingEnabled) => patch({ roundingEnabled })}
                />

                {form.roundingEnabled ? (
                  <FormLayout.Group>
                    <TextField
                      label="End prices in"
                      value={form.roundTo}
                      onChange={(roundTo) => patch({ roundTo })}
                      autoComplete="off"
                      inputMode="decimal"
                      prefix="."
                      helpText="For example 0.99 makes 10.20 into 10.99."
                    />
                    <Select
                      label="Round"
                      options={[
                        { label: 'Up', value: 'UP' },
                        { label: 'Down', value: 'DOWN' },
                        { label: 'Nearest', value: 'NEAREST' },
                      ]}
                      value={form.roundStrategy}
                      onChange={(value) =>
                        patch({
                          roundStrategy: value as 'UP' | 'DOWN' | 'NEAREST',
                        })
                      }
                    />
                  </FormLayout.Group>
                ) : null}

                <Checkbox
                  label="Show the old price struck through"
                  helpText="Moves the current price into compare-at so customers see the saving."
                  checked={form.setCompareAt}
                  onChange={(setCompareAt) => patch({ setCompareAt })}
                />
              </BlockStack>
            </Card>

            <TargetingSection form={form} onChange={patch} />

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Tags
                </Text>
                <TagEditor
                  label="Add these tags while the campaign runs"
                  values={form.addTags}
                  onChange={(addTags) => patch({ addTags })}
                />
                <TagEditor
                  label="Remove these tags while it runs"
                  values={form.removeTags}
                  onChange={(removeTags) => patch({ removeTags })}
                />
                <Text as="p" tone="subdued">
                  Both are put back exactly as they were when the campaign ends.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Schedule
                </Text>

                <ChoiceList
                  title="When should it start?"
                  titleHidden
                  choices={[
                    {
                      label: 'Activate immediately',
                      value: 'IMMEDIATELY',
                      helpText:
                        'Prices start changing as soon as you activate it.',
                    },
                    {
                      label: 'Schedule for later',
                      value: 'SCHEDULE',
                      helpText: 'Pick a date and time in the zone below.',
                    },
                  ]}
                  selected={[form.scheduleMode]}
                  onChange={(value) =>
                    patch({ scheduleMode: value[0] as ScheduleMode })
                  }
                />

                <FormLayout>
                  <Select
                    label="Time zone"
                    options={zoneOptions}
                    value={form.timezone}
                    onChange={(timezone) => patch({ timezone })}
                    helpText="Every date below is read in this zone, so the schedule survives a daylight-saving change."
                  />

                  {form.scheduleMode === 'SCHEDULE' ? (
                    <TextField
                      label="Starts"
                      type="datetime-local"
                      value={form.startAt}
                      onChange={(startAt) => patch({ startAt })}
                      autoComplete="off"
                      error={scheduleError ?? undefined}
                      helpText={
                        startsAtHint ??
                        'The campaign activates itself at this time.'
                      }
                    />
                  ) : (
                    <Banner tone="info">
                      <Text as="p">
                        It will start when you press Activate, and record that
                        moment as its start time.
                      </Text>
                    </Banner>
                  )}

                  <Checkbox
                    label="Give it an end date"
                    checked={form.hasEndDate}
                    onChange={(hasEndDate) => patch({ hasEndDate })}
                    helpText="Without one it runs until you end it yourself. Ending it puts every price back."
                  />

                  {form.hasEndDate ? (
                    <TextField
                      label="Ends"
                      type="datetime-local"
                      value={form.endAt}
                      onChange={(endAt) => patch({ endAt })}
                      autoComplete="off"
                      error={
                        form.scheduleMode === 'IMMEDIATELY'
                          ? (scheduleError ?? undefined)
                          : undefined
                      }
                      helpText={endsAtHint ?? undefined}
                    />
                  ) : null}
                </FormLayout>
              </BlockStack>
            </Card>
              </BlockStack>
            </fieldset>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <SummaryPanel form={form} currency={currency} />
        </Layout.Section>
      </Layout>

      {/*
        The preview prices what is *saved*, not what is on screen — the server
        recalculates from the stored campaign. So the modal says so rather than
        letting a merchant read unsaved numbers and trust them.
      */}
      {campaignId ? (
        <Modal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title="Preview changes"
          size="large"
          secondaryActions={[
            { content: 'Close', onAction: () => setPreviewOpen(false) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              {!saved && !readOnly ? (
                <Banner tone="info">
                  <Text as="p">
                    This shows the campaign as it was last saved. Save first to
                    preview changes you have just made.
                  </Text>
                </Banner>
              ) : null}
              <CampaignPreview campaignId={campaignId} />
            </BlockStack>
          </Modal.Section>
        </Modal>
      ) : null}
    </Page>
  );
}

/** A campaign that has run has results worth linking to. */
function hasRun(status: CampaignStatus): boolean {
  return (
    status === CampaignStatus.ACTIVE ||
    status === CampaignStatus.COMPLETED ||
    status === CampaignStatus.FAILED ||
    status === CampaignStatus.CANCELLED
  );
}

function TagEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const tag = draft.trim();
    // Case-insensitive, because Shopify treats tags that way and "Sale" twice
    // in different cases is one tag as far as the storefront is concerned.
    if (!tag || values.some((v) => v.toLowerCase() === tag.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...values, tag]);
    setDraft('');
  };

  return (
    <BlockStack gap="200">
      {/* Polaris TextField has no onKeyDown, so Enter is caught on a wrapper. */}
      <div
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      >
        <TextField
          label={label}
          value={draft}
          onChange={setDraft}
          onBlur={commit}
          autoComplete="off"
          placeholder="Type a tag and press Enter"
        />
      </div>
      {values.length > 0 ? (
        <InlineGrid columns={{ xs: 1 }}>
          <InlineStack gap="100" wrap>
            {values.map((tag) => (
              <Tag
                key={tag}
                onRemove={() => onChange(values.filter((v) => v !== tag))}
              >
                {tag}
              </Tag>
            ))}
          </InlineStack>
        </InlineGrid>
      ) : null}
    </BlockStack>
  );
}
