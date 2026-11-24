# Graph Report - RoomForge  (2026-11-24)

## Corpus Check
- 95 files · ~334,138 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: .css 3, (none) 1, .plist 1)

## Summary
- 1349 nodes · 3302 edges · 61 communities (55 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 68 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c119ba4a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- CheckIcon
- store.ts
- lib/types.ts
- routes.ts
- hub.ts
- RoomActions
- server/package.json
- five-agents.mjs
- web/package.json
- compilerOptions
- scripts
- compilerOptions
- RoomForge
- trigger.ts
- ChatPanel
- ProfileDialog.tsx
- roomforge-wake.mjs
- src/types.ts
- nowIso
- index.ts
- RightPanel.tsx
- VoiceStage.tsx
- RoomView.tsx
- demo-agent.mjs
- connector/package.json
- auth.ts
- roomforge-claude.mjs
- rooms.test.ts
- mission-routes.ts
- ChatPanel.tsx
- mission.ts
- db.ts
- buildAgentProfile
- MissionPanel.tsx
- roomforge-mcp.mjs
- Icons.tsx
- BranchIcon
- App
- AgentGuide.tsx
- RoomForge Agent API
- devDependencies
- CheckIcon
- RoomState
- FormattedMessage.tsx
- 10. Mission, questions, and decisions
- Collaboration architecture
- createRoom
- RoomSettingsDialog
- 12. Sleep and wake (trigger mode)
- 9. Work with tasks
- RoomView.tsx
- 24/7 Scalable Agent Architecture for RoomForge
- TasksPanel.tsx
- 11. Real-time over WebSocket
- scripts
- ApiError
- MissionPanel

## God Nodes (most connected - your core abstractions)
1. `RoomActions` - 61 edges
2. `ChatPanel()` - 60 edges
3. `Icon()` - 45 edges
4. `CheckIcon()` - 42 edges
5. `ArrowUpRightIcon()` - 35 edges
6. `App()` - 34 edges
7. `react` - 32 edges
8. `UsersIcon()` - 32 edges
9. `HttpError` - 31 edges
10. `CopyIcon()` - 31 edges

## Surprising Connections (you probably didn't know these)
- `WebSocket` --references--> `roomId()`  [INFERRED]
  README.md → connector/roomforge-mcp.mjs
- `Public site` --references--> `usePageMeta()`  [INFERRED]
  README.md → web/src/lib/meta.ts
- `10. Mission, questions, and decisions` --references--> `decide()`  [INFERRED]
  docs/agent-api.md → web/src/components/PeoplePanel.tsx
- `The collaboration loop` --references--> `decide()`  [INFERRED]
  docs/collaboration-architecture.md → web/src/components/PeoplePanel.tsx
- `What everyone sees live` --references--> `decide()`  [INFERRED]
  README.md → web/src/components/PeoplePanel.tsx

## Import Cycles
- None detected.

## Communities (61 total, 6 thin omitted)

### Community 0 - "CheckIcon"
Cohesion: 0.13
Nodes (30): ArrowUpRightIcon(), ChatIcon(), TerminalIcon(), UsersIcon(), activityIcon(), SiteFooter(), SiteHeader(), SitePage() (+22 more)

### Community 1 - "store.ts"
Cohesion: 0.04
Nodes (38): addRepo(), buildUserProfile(), createTriggerEvent(), deleteMessage(), findMessageByClientId(), findTaskByClientId(), findUserByHandle(), findUserById() (+30 more)

### Community 2 - "lib/types.ts"
Cohesion: 0.07
Nodes (53): AppProps, MemberProfileDialogProps, ProfileDialogProps, Activity, AgentProfile, AgentProfilePatch, CreateAgentResult, DecisionCloseInput (+45 more)

### Community 3 - "routes.ts"
Cohesion: 0.07
Nodes (25): AVATAR_COUNT, isAvatarId(), isAvatarValue(), isCustomAvatar(), MAX_AVATAR_LENGTH, agentCapabilitiesSchema, agentJoinSchema, agentProfilePatchSchema (+17 more)

### Community 4 - "hub.ts"
Cohesion: 0.06
Nodes (74): agentMessageLimiter, agentPresenceStatus(), agentSockets, attachHub(), attachPendingJoin(), broadcast(), broadcastJoinRequests(), broadcastMembers() (+66 more)

### Community 6 - "server/package.json"
Cohesion: 0.10
Nodes (20): express, tsx, @types/bcryptjs, @types/express, @types/jsonwebtoken, @types/node, @types/ws, zod (+12 more)

### Community 7 - "five-agents.mjs"
Cohesion: 0.07
Nodes (32): 1. Running Agents 24/7 (Persistent Mode), 2. Running Agents in Trigger Mode (Wake-on-Demand), 3. Client-Side Gateway & Live Monitor Dashboard, 4. Using `ResilientAgentSocket` in Your Own Code, 5. Installing as an OS Background Service, Gateway HTTP Endpoints, Linux (`systemd`), macOS (`launchd`) (+24 more)

### Community 8 - "web/package.json"
Cohesion: 0.08
Nodes (23): react-dom, @types/react, @types/react-dom, vite, @vitejs/plugin-react, dependencies, react, react-dom (+15 more)

### Community 9 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+8 more)

### Community 10 - "scripts"
Cohesion: 0.11
Nodes (18): devDependencies, concurrently, engines, node, name, private, scripts, agent (+10 more)

### Community 11 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, allowSyntheticDefaultImports, esModuleInterop, module, moduleResolution, noEmit, skipLibCheck, strict (+3 more)

### Community 12 - "RoomForge"
Cohesion: 0.14
Nodes (14): Agent API, Backups, Configuration, Connect an agent, Observability and maintenance, Project layout, Public site, Quick start (+6 more)

### Community 13 - "trigger.ts"
Cohesion: 0.11
Nodes (26): decryptSecret(), deliverDueTriggers(), deliverEvent(), DeliveryResult, ENCRYPTION_KEY, encryptSecret(), expireStaleWakes(), here (+18 more)

### Community 14 - "ChatPanel"
Cohesion: 0.10
Nodes (12): ChatPanel(), cancelEdit(), checkMention(), insertEmoji(), loadOlder(), saveEdit(), send(), startEdit() (+4 more)

### Community 15 - "ProfileDialog.tsx"
Cohesion: 0.12
Nodes (32): ArrowLeftIcon(), SparkleIcon(), ProfileAvatar(), Draft, draftFrom(), handleIsValid(), ProfileDialog(), changePassword() (+24 more)

### Community 16 - "roomforge-wake.mjs"
Cohesion: 0.06
Nodes (42): api(), broadcastSse(), buildPrompt(), catchUp(), [cmd, ...cmdArgs], cursor, enqueue(), eventHistory (+34 more)

### Community 17 - "src/types.ts"
Cohesion: 0.06
Nodes (38): CreateRoomMessageInput, NewQuestionInput, QuestionPatch, AgentProfileRow, InsertMessageOptions, JoinRequestRow, NewTaskInput, TaskPageQuery (+30 more)

### Community 18 - "nowIso"
Cohesion: 0.10
Nodes (23): pickAvatar(), addMember(), allocateHandle(), approveJoinRequest(), createAgent(), createJoinRequest(), createTask(), createUser() (+15 more)

### Community 19 - "index.ts"
Cohesion: 0.14
Nodes (17): closeDb(), app, closeHub, here, port, requestMetrics, server, shutdown() (+9 more)

### Community 20 - "RightPanel.tsx"
Cohesion: 0.14
Nodes (17): ActivityIcon(), CompassIcon(), LiveFeed(), STATUS_CHOICES, ReposPanel(), addRepo(), ReposPanelProps, PanelTab (+9 more)

### Community 21 - "VoiceStage.tsx"
Cohesion: 0.15
Nodes (11): VoiceStageProps, VoiceParticipant, audioConstraints(), iceServers, micErrorMessage(), newPeerId(), PeerRecord, useRoomVoice() (+3 more)

### Community 22 - "RoomView.tsx"
Cohesion: 0.19
Nodes (13): BellIcon(), FlagIcon(), LightbulbIcon(), MenuIcon(), MicIcon(), PanelsIcon(), isLiveEntry(), LIVE_STATUSES (+5 more)

### Community 23 - "demo-agent.mjs"
Cohesion: 0.13
Nodes (21): connect(), handleLine(), interactive, presence, printPresence(), prompt(), queued, resetWatchdog() (+13 more)

### Community 24 - "connector/package.json"
Cohesion: 0.10
Nodes (19): bin, roomforge-mcp, roomforge-wake, dependencies, ws, description, engines, node (+11 more)

### Community 25 - "auth.ts"
Cohesion: 0.13
Nodes (18): bcryptjs, jsonwebtoken, AuthedRequest, clearSessionCookie(), hashAgentToken(), hashPassword(), newAgentToken(), readSessionToken() (+10 more)

### Community 26 - "roomforge-claude.mjs"
Cohesion: 0.16
Nodes (19): api(), askClaude(), BASE, buildPrompt(), catchUp(), CATCHUP_MAX_AGE_MS, connect(), cursor (+11 more)

### Community 27 - "rooms.test.ts"
Cohesion: 0.16
Nodes (9): backfillHandles(), handleFromName(), handleValidationError(), normalizeHandle(), guest, guestPrincipal, owner, ownerPrincipal (+1 more)

### Community 28 - "mission-routes.ts"
Cohesion: 0.07
Nodes (30): HttpError, HttpErrorOptions, adminOrThrow(), DECISION_METHODS, decisionCloseSchema, decisionCreateSchema, emitFamily(), emitFamilyForMutation() (+22 more)

### Community 29 - "ChatPanel.tsx"
Cohesion: 0.16
Nodes (16): AUTHOR_COLORS, toggleAlerts(), dayLabel(), drafts, EMOJI_CATEGORIES, escapeRegExp(), getAuthorColor(), highlightQuery() (+8 more)

### Community 30 - "mission.ts"
Cohesion: 0.08
Nodes (39): castVote(), CONSENT_CHOICES, createDecision(), createQuestion(), DecisionOutcomeInput, dependenciesFor(), getDecision(), getFamilyView() (+31 more)

### Community 31 - "db.ts"
Cohesion: 0.11
Nodes (14): ws, backupDir, db, here, source, stamp, target, addColumn() (+6 more)

### Community 32 - "buildAgentProfile"
Cohesion: 0.18
Nodes (12): agentOwner(), buildAgentProfile(), getAgentProfile(), getAgentProfileByHandle(), getMembership(), getRoom(), getRoomByCode(), listMembers() (+4 more)

### Community 33 - "MissionPanel.tsx"
Cohesion: 0.24
Nodes (9): DecisionCardProps, METHODS, MissionPanelProps, PHASE_LABEL, PHASES, QuestionCardProps, Decision, DecisionMethod (+1 more)

### Community 34 - "roomforge-mcp.mjs"
Cohesion: 0.17
Nodes (28): api(), baseUrl, BridgeError, closeDecision(), createQuestion(), createTask(), createWorkstream(), getContext() (+20 more)

### Community 35 - "Icons.tsx"
Cohesion: 0.18
Nodes (21): ConfirmDialog(), ConfirmDialogProps, AlertTriangleIcon(), BellOffIcon(), CalendarIcon(), CameraIcon(), ChevronDownIcon(), CodeIcon() (+13 more)

### Community 36 - "BranchIcon"
Cohesion: 0.25
Nodes (8): BotIcon(), BranchIcon(), MESSAGES, ProductPreview(), TASKS, FEATURES, HomePage(), STEPS

### Community 37 - "App"
Cohesion: 0.09
Nodes (25): App(), copy(), handleAuth(), handleLogout(), handleProfileSaved(), showNotice(), submitNewRoom(), appendById() (+17 more)

### Community 38 - "AgentGuide.tsx"
Cohesion: 0.32
Nodes (5): AgentGuide(), AgentGuidePage(), AgentGuideProps, CodeBlock(), SECTIONS

### Community 39 - "RoomForge Agent API"
Cohesion: 0.13
Nodes (15): 13. MCP bridge, 14. Roles and limits, 15. Errors, 1. Get connected (two paths), 2. Join a room with a code (admin approval), 3. Base URL and headers, 4. Find your room, 5. Endpoint reference (+7 more)

### Community 40 - "devDependencies"
Cohesion: 0.25
Nodes (8): devDependencies, tsx, @types/bcryptjs, @types/express, @types/jsonwebtoken, @types/node, @types/ws, typescript

### Community 41 - "CheckIcon"
Cohesion: 0.14
Nodes (25): react, Avatar(), CheckIcon(), CopyIcon(), HashIcon(), PencilIcon(), PlusIcon(), ShieldIcon() (+17 more)

### Community 42 - "RoomState"
Cohesion: 0.18
Nodes (18): AvatarProps, ChatPanelProps, LiveFeedProps, PeoplePanelProps, ProfileAvatarProps, RightPanelProps, RoomCockpitProps, RoomPulseProps (+10 more)

### Community 43 - "FormattedMessage.tsx"
Cohesion: 0.36
Nodes (6): CodeBlock(), escapeRegExp(), FormattedMessage(), FormattedMessageProps, MentionTarget, renderInlineText()

### Community 44 - "10. Mission, questions, and decisions"
Cohesion: 0.20
Nodes (10): 10. Mission, questions, and decisions, Ask and answer before tasks exist, Open and close a decision, Split into workstreams, Context pack, Objects, The collaboration loop, Workstreams (+2 more)

### Community 45 - "Collaboration architecture"
Cohesion: 0.20
Nodes (9): Collaboration architecture, Decision rules, Design principles, Entry paths, Governance and trust, Implementation map, Liveness and consistency, Purpose (+1 more)

### Community 46 - "createRoom"
Cohesion: 0.28
Nodes (9): ensureMission(), getMission(), mapMission(), updateMission(), createRoom(), createWorkstreamRoom(), leaveRoom(), newRoomCode() (+1 more)

### Community 47 - "RoomSettingsDialog"
Cohesion: 0.50
Nodes (3): RoomSettingsDialog(), deleteRoom(), leaveRoom()

### Community 48 - "12. Sleep and wake (trigger mode)"
Cohesion: 0.29
Nodes (7): 12. Sleep and wake (trigger mode), Configure, Live Gateway & Wake Monitor Dashboard, Running 24/7 (Persistent Mode & OS Services), Wake, catch up, reply, sleep, Wake connector, What RoomForge sends

### Community 49 - "9. Work with tasks"
Cohesion: 0.50
Nodes (4): 9. Work with tasks, Claim and update a task, Create a task, Find tasks

### Community 52 - "RoomView.tsx"
Cohesion: 0.33
Nodes (11): HeadphonesIcon(), HeadphonesOffIcon(), MicOffIcon(), PhoneOffIcon(), SlidersIcon(), deviceName(), RemoteAudio(), RemoteAudioProps (+3 more)

### Community 54 - "24/7 Scalable Agent Architecture for RoomForge"
Cohesion: 0.17
Nodes (12): 1. Executive Summary & Scaling Horizons, 24/7 Scalable Agent Architecture for RoomForge, 2. What Keeps Agents Alive 24/7, 3. Project Components & Updated Files, 4. Running Agents as 24/7 Background OS Daemons, 5. Blueprint: Scaling to Millions of Agents, Client / Connector Layer, Linux (`systemd`) (+4 more)

### Community 55 - "TasksPanel.tsx"
Cohesion: 0.18
Nodes (10): FILTERS, GROUP_ORDER, TaskFilter, clockTime(), missionPhaseMeta, taskMeta, MissionPhase, PresenceStatus (+2 more)

### Community 56 - "11. Real-time over WebSocket"
Cohesion: 0.67
Nodes (3): 11. Real-time over WebSocket, 24/7 Production Resilience (Watchdog, Jittered Backoff, Sleep Detection), Fallback: HTTP polling

### Community 57 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, agent, backup, demo:agent, dev, start, test, typecheck

### Community 59 - "MissionPanel"
Cohesion: 0.13
Nodes (8): DecisionCard(), methodMeta(), MissionPanel(), QuestionCard(), take(), update(), voteLabel(), VoteTally()

## Knowledge Gaps
- **13 isolated node(s):** `ws`, `concurrently`, `ws`, `@types/bcryptjs`, `@types/express` (+8 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 522 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RoomForge` connect `RoomForge` to `10. Mission, questions, and decisions`, `24-7-agent-architecture.md`?**
  _High betweenness centrality (0.444) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `CheckIcon()` (e.g. with `AboutPage.tsx` and `HomePage.tsx`) actually correct?**
  _`CheckIcon()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ws`, `concurrently`, `ws` to the rest of the system?**
  _13 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `CheckIcon` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Why does `roomId()` connect `roomforge-mcp.mjs` to `roomforge-wake.mjs`, `RoomForge`, `db.ts`, `demo-agent.mjs`?**
  _High betweenness centrality (0.437) - this node is a cross-community bridge._
- **Should `store.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0401656314699793 - nodes in this community are weakly interconnected._
- **Should `lib/types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07207792207792207 - nodes in this community are weakly interconnected._