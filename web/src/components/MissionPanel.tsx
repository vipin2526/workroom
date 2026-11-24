import { useState } from 'react';
import type { FormEvent } from 'react';
import type {
  Decision,
  DecisionMethod,
  MissionPhase,
  MissionQuestion,
  RoomActions,
  RoomState,
} from '../lib/types';
import { missionPhaseMeta, timeAgo } from '../lib/format';
import { LinkifyText } from './LinkifyText';
import { CheckIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from './Icons';

interface MissionPanelProps {
  state: RoomState;
  actions: RoomActions;
}

const PHASES: { value: MissionPhase; label: string }[] = (
  Object.keys(missionPhaseMeta) as MissionPhase[]
).map((value) => ({ value, label: missionPhaseMeta[value].label }));

const METHODS: { value: DecisionMethod; label: string; description: string }[] = [
  { value: 'consent', label: 'Consent', description: 'One proposal. No objections carries it.' },
  { value: 'majority', label: 'Majority', description: 'Most votes wins once quorum is met.' },
  { value: 'quorum', label: 'Quorum', description: 'A minimum number must vote; most wins.' },
  { value: 'admin', label: 'Admin call', description: 'Votes advise; an admin decides.' },
];

const PHASE_LABEL = Object.fromEntries(PHASES.map((phase) => [phase.value, phase.label])) as Record<
  MissionPhase,
  string
>;

function methodMeta(method: DecisionMethod) {
  return METHODS.find((candidate) => candidate.value === method) ?? METHODS[0];
}

function voteLabel(decision: Decision, choice: string): string {
  const option = decision.options.find((candidate) => candidate.id === choice);
  if (option) return option.label;
  if (choice === 'consent') return 'Consent';
  if (choice === 'objection') return 'Objection';
  if (choice === 'abstain') return 'Abstain';
  return choice;
}

function VoteTally({ decision }: { decision: Decision }) {
  if (decision.method === 'consent') {
    return (
      <div className="decision-tally">
        <span className="tally-pill tone-green">{decision.tally.consent} consent</span>
        <span className="tally-pill tone-red">{decision.tally.objection} objection</span>
        <span className="tally-pill tone-gray">{decision.tally.abstain} abstain</span>
        <span className="tally-quorum">
          {decision.tally.votes}/{decision.quorum} votes
          {decision.tally.ready ? <span className="tally-ready">ready</span> : null}
        </span>
      </div>
    );
  }
  return (
    <div className="decision-options">
      {decision.options.map((option) => {
        const count = decision.tally.byOption[option.id] ?? 0;
        return (
          <div
            className={`decision-option ${decision.decidedOptionId === option.id ? 'chosen' : ''} ${
              decision.tally.leadingOptionId === option.id && decision.status === 'open' ? 'leading' : ''
            }`}
            key={option.id}
          >
            <span className="decision-option-label">{option.label}</span>
            <span className="decision-option-count">{count}</span>
          </div>
        );
      })}
      <div className="tally-quorum">
        {decision.tally.votes}/{decision.quorum} votes
        {decision.tally.ready ? <span className="tally-ready">ready</span> : null}
      </div>
    </div>
  );
}

interface QuestionCardProps {
  question: MissionQuestion;
  state: RoomState;
  actions: RoomActions;
}

function QuestionCard({ question, state, actions }: QuestionCardProps) {
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState(question.resolution);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = state.me.role === 'admin';
  const isViewer = state.me.role === 'viewer';
  const isOwner = question.ownerType === state.me.type && question.ownerId === state.me.id;
  const isAuthor = question.createdByType === state.me.type && question.createdById === state.me.id;
  const canDelete = isAdmin || isAuthor;

  async function update(input: Parameters<RoomActions['updateQuestion']>[1]) {
    setBusy(true);
    setError(null);
    try {
      await actions.updateQuestion(question.id, input);
      setResolving(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the question');
    } finally {
      setBusy(false);
    }
  }

  async function take() {
    await update({ ownerType: state.me.type, ownerId: state.me.id });
  }

  async function remove() {
    const ok = await actions.confirm({
      title: 'Delete question?',
      message: `Delete the question “${question.title}”? This action cannot be undone.`,
      confirmText: 'Delete Question',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await actions.deleteQuestion(question.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the question');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`question-card status-${question.status}`}>
      <div className="question-head">
        <h4>{question.title}</h4>
        {question.status !== 'open' ? (
          <span className={`tag ${question.status === 'resolved' ? 'tag-green' : 'tag-gray'}`}>
            {question.status}
          </span>
        ) : null}
        {canDelete && !isViewer ? (
          <button
            type="button"
            className="task-delete-btn"
            title="Delete question"
            aria-label={`Delete question ${question.title}`}
            onClick={remove}
            disabled={busy}
          >
            <TrashIcon size={12} />
          </button>
        ) : null}
      </div>
      {question.detail ? (
        <p className="question-detail">
          <LinkifyText text={question.detail} />
        </p>
      ) : null}
      <div className="question-meta">
        <span>{question.ownerName ? `Owner: ${question.ownerName}` : 'No owner'}</span>
        <span>by {question.createdByName}</span>
        <span>{timeAgo(question.updatedAt)}</span>
      </div>
      {question.status === 'resolved' && question.resolution ? (
        <p className="question-resolution">
          <CheckIcon size={12} /> {question.resolution}
        </p>
      ) : null}

      {question.status === 'open' && !isViewer ? (
        <div className="question-actions">
          {isOwner ? (
            <button
              type="button"
              className="btn btn-quiet btn-tiny"
              onClick={() => setResolving((value) => !value)}
            >
              {resolving ? 'Cancel' : 'Resolve'}
            </button>
          ) : (
            <button type="button" className="btn btn-quiet btn-tiny" onClick={take} disabled={busy}>
              Take ownership
            </button>
          )}
          {isOwner ? (
            <button
              type="button"
              className="btn btn-ghost btn-tiny"
              onClick={() => update({ ownerType: null, ownerId: null })}
              disabled={busy}
            >
              Release
            </button>
          ) : null}
        </div>
      ) : null}

      {resolving ? (
        <div className="question-resolve">
          <textarea
            className="textarea"
            rows={2}
            value={resolution}
            placeholder="What did the room learn, and what does it change?"
            onChange={(event) => setResolution(event.target.value)}
          />
          <div className="inline-actions">
            <button
              type="button"
              className="btn btn-primary btn-tiny"
              disabled={busy || !resolution.trim()}
              onClick={() => update({ status: 'resolved', resolution: resolution.trim() })}
            >
              {busy ? 'Saving…' : 'Resolve'}
            </button>
            <button type="button" className="btn btn-ghost btn-tiny" onClick={() => setResolving(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </article>
  );
}

interface DecisionCardProps {
  decision: Decision;
  state: RoomState;
  actions: RoomActions;
}

function DecisionCard({ decision, state, actions }: DecisionCardProps) {
  const [closing, setClosing] = useState(false);
  const [choice, setChoice] = useState(
    decision.tally.leadingOptionId ?? decision.options[0]?.id ?? '',
  );
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = state.me.role === 'admin';
  const isViewer = state.me.role === 'viewer';
  const isCreator = decision.createdByType === state.me.type && decision.createdById === state.me.id;
  const canClose = (isAdmin || isCreator) && !isViewer && decision.status === 'open';
  const myVote = decision.votes.find(
    (vote) => vote.voterType === state.me.type && vote.voterId === state.me.id,
  );
  const meta = methodMeta(decision.method);
  const overdue = decision.dueAt ? new Date(decision.dueAt).getTime() < Date.now() : false;
  const openDependencies = decision.dependencies.filter((dependency) => dependency.status !== 'decided');

  async function vote(value: string) {
    setBusy(true);
    setError(null);
    try {
      await actions.voteDecision(decision.id, value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the vote');
    } finally {
      setBusy(false);
    }
  }

  async function close(status: 'decided' | 'withdrawn') {
    setBusy(true);
    setError(null);
    try {
      await actions.closeDecision(decision.id, {
        status,
        optionId:
          status === 'decided'
            ? decision.method === 'consent'
              ? decision.options[0]?.id ?? null
              : choice
            : null,
        rationale: rationale.trim(),
      });
      setClosing(false);
      setRationale('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close the decision');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`decision-card status-${decision.status}`}>
      <div className="decision-head">
        <h4>{decision.title}</h4>
        <span className={`tag ${decision.status === 'open' ? 'tag-amber' : decision.status === 'decided' ? 'tag-green' : 'tag-gray'}`}>
          {decision.status}
        </span>
      </div>
      <div className="decision-meta">
        <span>{meta.label}</span>
        <span>by {decision.createdByName}</span>
        <span>{timeAgo(decision.createdAt)}</span>
        {decision.dueAt ? (
          <span className={overdue && decision.status === 'open' ? 'overdue' : ''}>
            due {new Date(decision.dueAt).toLocaleDateString()}
          </span>
        ) : null}
      </div>
      {decision.context ? (
        <p className="decision-context">
          <LinkifyText text={decision.context} />
        </p>
      ) : null}

      {decision.dependencies.length > 0 ? (
        <div className="decision-dependencies">
          <span className="mini-label">
            {openDependencies.length > 0 ? 'Blocked by' : 'Dependencies'}
          </span>
          <div className="dependency-chips">
            {decision.dependencies.map((dependency) => (
              <span
                className={`dependency-chip ${dependency.status === 'decided' ? 'resolved' : 'open'}`}
                key={`${dependency.roomId}:${dependency.decisionId}`}
                title={`${dependency.roomName}: ${dependency.title} (${dependency.status})`}
              >
                {dependency.status === 'decided' ? <CheckIcon size={10} /> : <span className="dot" />}
                {dependency.title}
                <em>{dependency.roomName}</em>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <VoteTally decision={decision} />

      {decision.status === 'open' && !isViewer ? (
        <div className="decision-vote">
          <span className="mini-label">Your vote</span>
          {decision.method === 'consent' ? (
            <div className="vote-buttons">
              {(['consent', 'objection', 'abstain'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`vote-btn ${myVote?.choice === value ? 'active' : ''} tone-${value === 'consent' ? 'green' : value === 'objection' ? 'red' : 'gray'}`}
                  disabled={busy}
                  onClick={() => vote(value)}
                >
                  {value === 'consent' ? 'Consent' : value === 'objection' ? 'Object' : 'Abstain'}
                </button>
              ))}
            </div>
          ) : (
            <div className="vote-buttons">
              {decision.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`vote-btn ${myVote?.choice === option.id ? 'active' : ''}`}
                  disabled={busy}
                  onClick={() => vote(option.id)}
                >
                  {option.label}
                  <span className="vote-count">{decision.tally.byOption[option.id] ?? 0}</span>
                </button>
              ))}
              <button
                type="button"
                className={`vote-btn ${myVote?.choice === 'abstain' ? 'active' : ''}`}
                disabled={busy}
                onClick={() => vote('abstain')}
              >
                Abstain
              </button>
            </div>
          )}
        </div>
      ) : null}

      {decision.votes.length > 0 ? (
        <div className="decision-voters">
          {decision.votes.slice(0, 6).map((vote) => (
            <span className="voter-chip" key={`${vote.voterType}:${vote.voterId}`}>
              {vote.voterName} · {voteLabel(decision, vote.choice)}
            </span>
          ))}
          {decision.votes.length > 6 ? (
            <span className="voter-chip">+{decision.votes.length - 6}</span>
          ) : null}
        </div>
      ) : null}

      {decision.status === 'open' && canClose ? (
        <div className="decision-close">
          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            onClick={() => setClosing((value) => !value)}
          >
            {closing ? 'Cancel' : 'Resolve decision'}
          </button>
        </div>
      ) : null}

      {closing ? (
        <div className="decision-close-form">
          {!decision.tally.ready && !isAdmin ? (
            <p className="form-hint">Quorum or a clear outcome is still missing.</p>
          ) : null}
          {openDependencies.length > 0 ? (
            <p className="form-hint">
              Blocked by “{openDependencies[0].title}”. The author cannot close until it is
              decided; an admin can override with a rationale.
            </p>
          ) : null}
          {decision.method !== 'consent' ? (
            <label className="field">
              <span>Outcome</span>
              <select
                className="select"
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
              >
                {decision.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="form-hint">Outcome: {decision.options[0]?.label}</p>
          )}
          <label className="field">
            <span>
              Rationale{' '}
              {isAdmin && (!decision.tally.ready || openDependencies.length > 0)
                ? '(required)'
                : '(optional)'}
            </span>
            <textarea
              className="textarea"
              rows={2}
              value={rationale}
              placeholder="Why this outcome, and what dissent is recorded?"
              onChange={(event) => setRationale(event.target.value)}
            />
          </label>
          <div className="inline-actions">
            <button
              type="button"
              className="btn btn-primary btn-tiny"
              disabled={busy}
              onClick={() => close('decided')}
            >
              {busy ? 'Saving…' : 'Record decision'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-tiny"
              disabled={busy}
              onClick={() => close('withdrawn')}
            >
              Withdraw
            </button>
          </div>
        </div>
      ) : null}

      {decision.status !== 'open' ? (
        <div className="decision-outcome">
          {decision.status === 'decided' ? (
            <p>
              <strong>{decision.decidedOptionLabel ?? 'Decided'}</strong>
              {decision.rationale ? ` — ${decision.rationale}` : ''}
            </p>
          ) : (
            <p>Withdrawn{decision.rationale ? ` — ${decision.rationale}` : ''}</p>
          )}
          <span>
            {decision.decidedByName ?? 'someone'} · {timeAgo(decision.decidedAt)}
          </span>
        </div>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </article>
  );
}

export function MissionPanel({ state, actions }: MissionPanelProps) {
  const mission = state.mission;
  const isAdmin = state.me.role === 'admin';
  const isViewer = state.me.role === 'viewer';
  const openQuestions = state.questions.filter((question) => question.status === 'open');
  const answeredQuestions = state.questions.filter((question) => question.status !== 'open');
  const openDecisions = state.decisions.filter((decision) => decision.status === 'open');
  const closedDecisions = state.decisions.filter((decision) => decision.status !== 'open');

  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState(mission.objective);
  const [successCriteria, setSuccessCriteria] = useState(mission.successCriteria);
  const [constraints, setConstraints] = useState(mission.constraints);
  const [phase, setPhase] = useState(mission.phase);
  const [decisionMode, setDecisionMode] = useState(mission.decisionMode);
  const [quorum, setQuorum] = useState(String(mission.quorum));
  const [missionError, setMissionError] = useState<string | null>(null);
  const [missionBusy, setMissionBusy] = useState(false);

  const [questionOpen, setQuestionOpen] = useState(false);
  const [questionTitle, setQuestionTitle] = useState('');
  const [questionDetail, setQuestionDetail] = useState('');
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [questionBusy, setQuestionBusy] = useState(false);

  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionTitle, setDecisionTitle] = useState('');
  const [decisionContext, setDecisionContext] = useState('');
  const [decisionMethod, setDecisionMethod] = useState<DecisionMethod>(mission.decisionMode);
  const [decisionQuorum, setDecisionQuorum] = useState(String(mission.quorum));
  const [decisionOptions, setDecisionOptions] = useState('Option A\nOption B');
  const [decisionDue, setDecisionDue] = useState('');
  const [decisionNotify, setDecisionNotify] = useState(true);
  const [decisionDependsOn, setDecisionDependsOn] = useState<string[]>([]);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);

  const [workstreamOpen, setWorkstreamOpen] = useState(false);
  const [workstreamName, setWorkstreamName] = useState('');
  const [workstreamTopic, setWorkstreamTopic] = useState('');
  const [workstreamObjective, setWorkstreamObjective] = useState('');
  const [workstreamError, setWorkstreamError] = useState<string | null>(null);
  const [workstreamBusy, setWorkstreamBusy] = useState(false);

  function startEditing() {
    setObjective(mission.objective);
    setSuccessCriteria(mission.successCriteria);
    setConstraints(mission.constraints);
    setPhase(mission.phase);
    setDecisionMode(mission.decisionMode);
    setQuorum(String(mission.quorum));
    setMissionError(null);
    setEditing(true);
  }

  async function saveMission(event: FormEvent) {
    event.preventDefault();
    setMissionBusy(true);
    setMissionError(null);
    try {
      await actions.updateMission({
        objective: objective.trim(),
        successCriteria: successCriteria.trim(),
        constraints: constraints.trim(),
        phase,
        decisionMode,
        quorum: Math.max(1, Number(quorum) || 1),
      });
      setEditing(false);
    } catch (err) {
      setMissionError(err instanceof Error ? err.message : 'Could not update the mission');
    } finally {
      setMissionBusy(false);
    }
  }

  async function addQuestion(event: FormEvent) {
    event.preventDefault();
    setQuestionBusy(true);
    setQuestionError(null);
    try {
      await actions.createQuestion({
        title: questionTitle.trim(),
        detail: questionDetail.trim(),
      });
      setQuestionTitle('');
      setQuestionDetail('');
      setQuestionOpen(false);
    } catch (err) {
      setQuestionError(err instanceof Error ? err.message : 'Could not add the question');
    } finally {
      setQuestionBusy(false);
    }
  }

  async function addWorkstream(event: FormEvent) {
    event.preventDefault();
    setWorkstreamBusy(true);
    setWorkstreamError(null);
    try {
      const workstream = await actions.createWorkstream({
        name: workstreamName.trim(),
        topic: workstreamTopic.trim(),
        objective: workstreamObjective.trim(),
      });
      setWorkstreamName('');
      setWorkstreamTopic('');
      setWorkstreamObjective('');
      setWorkstreamOpen(false);
      if (workstream) actions.openRoom(workstream.id);
    } catch (err) {
      setWorkstreamError(err instanceof Error ? err.message : 'Could not create the workstream');
    } finally {
      setWorkstreamBusy(false);
    }
  }

  async function addDecision(event: FormEvent) {
    event.preventDefault();
    setDecisionError(null);
    const options = decisionOptions
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (decisionMethod === 'consent' && options.length !== 1) {
      setDecisionError('Consent decisions need exactly one proposal line.');
      return;
    }
    if (decisionMethod !== 'consent' && options.length < 2) {
      setDecisionError('Add at least two options, one per line.');
      return;
    }
    let dueAt: string | null = null;
    if (decisionDue) {
      const parsed = new Date(decisionDue);
      if (Number.isNaN(parsed.getTime())) {
        setDecisionError('The due date is not valid.');
        return;
      }
      dueAt = parsed.toISOString();
    }
    setDecisionBusy(true);
    try {
      await actions.createDecision({
        title: decisionTitle.trim(),
        context: decisionContext.trim(),
        method: decisionMethod,
        quorum: Math.max(1, Number(decisionQuorum) || 1),
        options,
        dueAt,
        notifyAgents: decisionNotify,
        dependsOn: decisionDependsOn.map((key) => {
          const [roomId, decisionId] = key.split(':');
          return { roomId, decisionId };
        }),
      });
      setDecisionTitle('');
      setDecisionContext('');
      setDecisionOptions('Option A\nOption B');
      setDecisionDue('');
      setDecisionDependsOn([]);
      setDecisionOpen(false);
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : 'Could not open the decision');
    } finally {
      setDecisionBusy(false);
    }
  }

  const phaseLabel = PHASE_LABEL[mission.phase];
  const method = methodMeta(mission.decisionMode);
  const editingMethod = methodMeta(decisionMode);

  function changeDecisionMethod(next: DecisionMethod) {
    setDecisionMethod(next);
    const count = decisionOptions.split('\n').filter((line) => line.trim()).length;
    if (next === 'consent' && count !== 1) setDecisionOptions('Proposal');
    if (next !== 'consent' && count < 2) setDecisionOptions('Option A\nOption B');
  }

  return (
    <div className="panel-scroll">
      <div className="panel-heading">
        <span>Mission</span>
        <div className="panel-heading-actions">
          <span className="section-count">{openDecisions.length + openQuestions.length} open</span>
          {isAdmin && !isViewer ? (
            <button
              type="button"
              className="btn btn-quiet btn-tiny"
              onClick={() => (editing ? setEditing(false) : startEditing())}
            >
              {editing ? <XIcon size={13} /> : <PencilIcon size={13} />}
              {editing ? 'Close' : 'Edit brief'}
            </button>
          ) : null}
        </div>
      </div>

      <section className="mission-brief">
        <div className="mission-brief-top">
          <span className={`phase-chip phase-${mission.phase}`}>{phaseLabel}</span>
          <span className="mission-rule" title={method.description}>
            {method.label} · quorum {mission.quorum}
          </span>
        </div>
        {mission.objective ? (
          <p className="mission-objective">
            <LinkifyText text={mission.objective} />
          </p>
        ) : (
          <p className="mission-objective empty">
            No mission objective yet. This room is still framing the problem — agents can join now
            and help define it.
          </p>
        )}
        {mission.successCriteria ? (
          <div className="mission-block">
            <span className="section-label">Success criteria</span>
            <p>
              <LinkifyText text={mission.successCriteria} />
            </p>
          </div>
        ) : null}
        {mission.constraints ? (
          <div className="mission-block">
            <span className="section-label">Constraints</span>
            <p>
              <LinkifyText text={mission.constraints} />
            </p>
          </div>
        ) : null}
        <div className="mission-brief-foot">
          <span>Updated {timeAgo(mission.updatedAt)}</span>
        </div>
      </section>

      {editing ? (
        <form className="inline-form" onSubmit={saveMission}>
          <label className="field">
            <span>Objective</span>
            <textarea
              className="textarea"
              rows={3}
              value={objective}
              placeholder="What problem are we solving, in one or two sentences?"
              onChange={(event) => setObjective(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Success criteria</span>
            <textarea
              className="textarea"
              rows={3}
              value={successCriteria}
              placeholder="How will we know it is solved? One criterion per line."
              onChange={(event) => setSuccessCriteria(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Constraints</span>
            <textarea
              className="textarea"
              rows={2}
              value={constraints}
              placeholder="Time, budget, compatibility, safety, non-goals…"
              onChange={(event) => setConstraints(event.target.value)}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Phase</span>
              <select
                className="select"
                value={phase}
                onChange={(event) => setPhase(event.target.value as MissionPhase)}
              >
                {PHASES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Decision rule</span>
              <select
                className="select"
                value={decisionMode}
                onChange={(event) => setDecisionMode(event.target.value as DecisionMethod)}
              >
                {METHODS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Quorum</span>
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              value={quorum}
              onChange={(event) => setQuorum(event.target.value)}
            />
          </label>
          <p className="form-hint">{editingMethod.description}</p>
          {missionError ? <p className="form-error">{missionError}</p> : null}
          <button type="submit" className="btn btn-primary btn-small" disabled={missionBusy}>
            {missionBusy ? 'Saving…' : 'Save mission'}
          </button>
        </form>
      ) : null}

      <section className="panel-section">
        <div className="panel-heading">
          <span>Workstreams</span>
          <div className="panel-heading-actions">
            <span className="section-count">{state.workstreams.length}</span>
            {isAdmin ? (
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                onClick={() => setWorkstreamOpen((value) => !value)}
              >
                {workstreamOpen ? <XIcon size={13} /> : <PlusIcon size={13} />}
                {workstreamOpen ? 'Close' : 'Split'}
              </button>
            ) : null}
          </div>
        </div>
        {state.parent ? (
          <div className="parent-workstream">
            <span className="section-label">Part of</span>
            <button
              type="button"
              className="workstream-open"
              onClick={() => actions.openRoom(state.parent!.id)}
            >
              {state.parent.name}
              <span className={`phase-chip phase-${state.parent.phase}`}>
                {PHASE_LABEL[state.parent.phase]}
              </span>
            </button>
          </div>
        ) : null}
        {workstreamOpen ? (
          <form className="inline-form" onSubmit={addWorkstream}>
            <label className="field">
              <span>Name</span>
              <input
                className="input"
                value={workstreamName}
                onChange={(event) => setWorkstreamName(event.target.value)}
                placeholder="Auth and sessions"
                required
              />
            </label>
            <label className="field">
              <span>Focus</span>
              <input
                className="input"
                value={workstreamTopic}
                onChange={(event) => setWorkstreamTopic(event.target.value)}
                placeholder="What part of the mission this room owns"
              />
            </label>
            <label className="field">
              <span>Objective</span>
              <textarea
                className="textarea"
                rows={2}
                value={workstreamObjective}
                onChange={(event) => setWorkstreamObjective(event.target.value)}
                placeholder="The outcome this workstream must reach."
              />
            </label>
            <p className="form-hint">
              Human members are copied with their roles. Agents are room-scoped, so add them to the
              new room separately.
            </p>
            {workstreamError ? <p className="form-error">{workstreamError}</p> : null}
            <button
              type="submit"
              className="btn btn-primary btn-small"
              disabled={workstreamBusy || !workstreamName.trim()}
            >
              {workstreamBusy ? 'Creating…' : 'Create workstream'}
            </button>
          </form>
        ) : null}
        {state.workstreams.length === 0 ? (
          <p className="panel-empty">
            No workstreams. Split an oversized mission into rooms with their own questions,
            decisions, and agents.
          </p>
        ) : (
          <div className="workstream-list">
            {state.workstreams.map((workstream) => (
              <article className="workstream-card" key={workstream.id}>
                <div className="workstream-head">
                  <button
                    type="button"
                    className="workstream-open"
                    onClick={() => actions.openRoom(workstream.id)}
                  >
                    {workstream.name}
                  </button>
                  <span className={`phase-chip phase-${workstream.phase}`}>
                    {PHASE_LABEL[workstream.phase]}
                  </span>
                </div>
                {workstream.objective ? (
                  <p className="workstream-objective">
                    <LinkifyText text={workstream.objective} />
                  </p>
                ) : null}
                <div className="workstream-meta">
                  <span>{workstream.openQuestions} questions</span>
                  <span>{workstream.openDecisions} decisions</span>
                  {workstream.blockedDecisions > 0 ? (
                    <span className="blocked">{workstream.blockedDecisions} blocked</span>
                  ) : null}
                  <span>{workstream.memberCount} members</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel-section">
        <div className="panel-heading">
          <span>Open questions</span>
          <div className="panel-heading-actions">
            <span className="section-count">{openQuestions.length}</span>
            {!isViewer ? (
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                onClick={() => setQuestionOpen((value) => !value)}
              >
                {questionOpen ? <XIcon size={13} /> : <PlusIcon size={13} />}
                {questionOpen ? 'Close' : 'Add'}
              </button>
            ) : null}
          </div>
        </div>
        {questionOpen ? (
          <form className="inline-form" onSubmit={addQuestion}>
            <label className="field">
              <span>Question</span>
              <input
                className="input"
                value={questionTitle}
                onChange={(event) => setQuestionTitle(event.target.value)}
                placeholder="What must we learn before we can move?"
                required
              />
            </label>
            <label className="field">
              <span>Context</span>
              <textarea
                className="textarea"
                rows={2}
                value={questionDetail}
                onChange={(event) => setQuestionDetail(event.target.value)}
                placeholder="Why it matters, what evidence would answer it."
              />
            </label>
            {questionError ? <p className="form-error">{questionError}</p> : null}
            <button
              type="submit"
              className="btn btn-primary btn-small"
              disabled={questionBusy || !questionTitle.trim()}
            >
              {questionBusy ? 'Adding…' : 'Add question'}
            </button>
          </form>
        ) : null}
        {openQuestions.length === 0 ? (
          <p className="panel-empty">
            No open questions. In framing, ask what the room does not know yet — agents can take
            ownership of a question before any task exists.
          </p>
        ) : (
          openQuestions.map((question) => (
            <QuestionCard key={question.id} question={question} state={state} actions={actions} />
          ))
        )}
      </section>

      <section className="panel-section">
        <div className="panel-heading">
          <span>Decisions</span>
          <div className="panel-heading-actions">
            <span className="section-count">{openDecisions.length} open</span>
            {!isViewer ? (
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                onClick={() => setDecisionOpen((value) => !value)}
              >
                {decisionOpen ? <XIcon size={13} /> : <PlusIcon size={13} />}
                {decisionOpen ? 'Close' : 'New'}
              </button>
            ) : null}
          </div>
        </div>
        {decisionOpen ? (
          <form className="inline-form" onSubmit={addDecision}>
            <label className="field">
              <span>Decision</span>
              <input
                className="input"
                value={decisionTitle}
                onChange={(event) => setDecisionTitle(event.target.value)}
                placeholder="Which approach do we commit to?"
                required
              />
            </label>
            <label className="field">
              <span>Context</span>
              <textarea
                className="textarea"
                rows={2}
                value={decisionContext}
                onChange={(event) => setDecisionContext(event.target.value)}
                placeholder="Evidence, tradeoffs, and what the room should weigh."
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Method</span>
                <select
                  className="select"
                  value={decisionMethod}
                  onChange={(event) => changeDecisionMethod(event.target.value as DecisionMethod)}
                >
                  {METHODS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Quorum</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={50}
                  value={decisionQuorum}
                  onChange={(event) => setDecisionQuorum(event.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span>
                {decisionMethod === 'consent' ? 'Proposal (one line)' : 'Options (one per line)'}
              </span>
              <textarea
                className="textarea"
                rows={3}
                value={decisionOptions}
                onChange={(event) => setDecisionOptions(event.target.value)}
                placeholder={'Option A\nOption B'}
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Due</span>
                <input
                  className="input"
                  type="datetime-local"
                  value={decisionDue}
                  onChange={(event) => setDecisionDue(event.target.value)}
                />
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={decisionNotify}
                  onChange={(event) => setDecisionNotify(event.target.checked)}
                />
                <span>Wake agents</span>
              </label>
            </div>
            {state.relatedDecisions.length > 0 ? (
              <div className="field">
                <span>Blocked by (optional)</span>
                <div className="dependency-options">
                  {state.relatedDecisions.slice(0, 5).map((reference) => {
                    const key = `${reference.roomId}:${reference.id}`;
                    return (
                      <label className="checkbox-field" key={key}>
                        <input
                          type="checkbox"
                          checked={decisionDependsOn.includes(key)}
                          onChange={(event) =>
                            setDecisionDependsOn((previous) =>
                              event.target.checked
                                ? [...previous, key]
                                : previous.filter((value) => value !== key),
                            )
                          }
                        />
                        <span>
                          {reference.title} <em>{reference.roomName}</em>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="form-hint">
                  An unresolved dependency prevents the author from closing this decision.
                </p>
              </div>
            ) : null}
            <p className="form-hint">{methodMeta(decisionMethod).description}</p>
            {decisionError ? <p className="form-error">{decisionError}</p> : null}
            <button
              type="submit"
              className="btn btn-primary btn-small"
              disabled={decisionBusy || !decisionTitle.trim()}
            >
              {decisionBusy ? 'Opening…' : 'Open decision'}
            </button>
          </form>
        ) : null}
        {openDecisions.length === 0 ? (
          <p className="panel-empty">
            No open decisions. When the room faces a real fork, write the options and the rule
            first, then let people and agents vote.
          </p>
        ) : (
          openDecisions.map((decision) => (
            <DecisionCard key={decision.id} decision={decision} state={state} actions={actions} />
          ))
        )}
      </section>

      {closedDecisions.length > 0 ? (
        <section className="panel-section">
          <div className="panel-heading">
            <span>Recently closed</span>
            <span className="section-count">{closedDecisions.length}</span>
          </div>
          {closedDecisions.slice(0, 5).map((decision) => (
            <DecisionCard key={decision.id} decision={decision} state={state} actions={actions} />
          ))}
        </section>
      ) : null}

      {answeredQuestions.length > 0 ? (
        <section className="panel-section">
          <div className="panel-heading">
            <span>Resolved & parked</span>
            <span className="section-count">{answeredQuestions.length}</span>
          </div>
          {answeredQuestions.slice(0, 5).map((question) => (
            <QuestionCard key={question.id} question={question} state={state} actions={actions} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
