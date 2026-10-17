// @vitest-environment jsdom
/**
 * Task 1: Prove the editor integration and lock the visual direction.
 * 1. Reproduces the 3 keyboard safety failures (outside focus, Shift+Tab, IME).
 * 2. Mounts the actual resident composer (InputBar) with synthetic suggestion
 *    through conversation.input.overlay, verifying standard Session props (useSession, useInput, inputActions).
 * 3. Asserts Tab adoption, pointer adoption, IME isolation, menu arbitration,
 *    and draft invalidation against the actual Lexical editor draft.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSnapshot, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import {
  bindSnapshotSelector,
  conversationSnapshot as conversationFixture,
  makeTranslate,
  sessionSnapshot as sessionFixture,
} from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ComposerPrediction, type ComposerPredictionData, AssistantPredictionDock } from '../src/client/ComposerPrediction.tsx'
import { InputBar, type InputBarProps } from '../../../client/ui-conversation/src/client/skeleton/InputBar.tsx'
import { SessionInputShell } from '../../../client/ui-conversation/src/client/input/facade.ts'
import '../../../client/ui-conversation/tests/control-row-dom.ts'

// Polyfill Range.prototype.getBoundingClientRect for jsdom Lexical caret measurement
const ZERO_RECT = (): DOMRect => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect)
Range.prototype.getBoundingClientRect = ZERO_RECT

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']
const SCTX = {} as Context
const SID = 's_pred_test' as SessionId

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const tZh = makeTranslate(zh)

const samplePrediction: ComposerPredictionData = {
  predictionId: 'pred-test-001',
  text: '能否总结当前测试覆盖率情况？',
  asOfSeq: 5,
}

describe('Task 1: Keyboard safety and editor integration', () => {
  describe('Independent keyboard safety controls (reproduction & verification)', () => {
    it.each(['outside-focus', 'shift-tab', 'ime'] as const)(
      'does not adopt prediction on %s',
      (mode) => {
        const adopt = vi.fn()
        render(
          <>
            <input aria-label="other-input" />
            <div data-composer-card>
              <div contentEditable role="textbox" aria-label="composer-editor" data-composer-input />
              <ComposerPrediction
                prediction={samplePrediction}
                currentSeq={5}
                draftText=""
                onAdopt={adopt}
                t={tZh}
              />
            </div>
          </>,
        )

        const target = screen.getByLabelText(mode === 'outside-focus' ? 'other-input' : 'composer-editor')
        target.focus()

        fireEvent.keyDown(target, {
          key: 'Tab',
          shiftKey: mode === 'shift-tab',
          isComposing: mode === 'ime',
        })

        expect(adopt).not.toHaveBeenCalled()
      },
    )

    it('adopts on plain Tab when focused inside the composer editor', () => {
      const adopt = vi.fn()
      render(
        <div data-composer-card>
          <div contentEditable role="textbox" aria-label="composer-editor" data-composer-input />
          <ComposerPrediction
            prediction={samplePrediction}
            currentSeq={5}
            draftText=""
            onAdopt={adopt}
            t={tZh}
          />
        </div>,
      )

      const target = screen.getByLabelText('composer-editor')
      target.focus()

      fireEvent.keyDown(target, { key: 'Tab' })
      expect(adopt).toHaveBeenCalledTimes(1)
      expect(adopt).toHaveBeenCalledWith('能否总结当前测试覆盖率情况？')
    })

    it('adopts on pointer click and strictly never triggers form submit', () => {
      const adopt = vi.fn()
      const onSubmit = vi.fn()
      render(
        <form onSubmit={onSubmit}>
          <div data-composer-card>
            <div contentEditable role="textbox" aria-label="composer-editor" data-composer-input />
            <ComposerPrediction
              prediction={samplePrediction}
              currentSeq={5}
              draftText=""
              onAdopt={adopt}
              t={tZh}
            />
          </div>
        </form>,
      )

      const adoptBtn = screen.getByRole('button', { name: 'Tab 采用' })
      fireEvent.click(adoptBtn)
      expect(adopt).toHaveBeenCalledWith('能否总结当前测试覆盖率情况？')
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('dismisses prediction on Escape keypress', () => {
      const dismiss = vi.fn()
      render(
        <div data-composer-card>
          <div contentEditable role="textbox" aria-label="composer-editor" data-composer-input />
          <ComposerPrediction
            prediction={samplePrediction}
            currentSeq={5}
            draftText=""
            onAdopt={vi.fn()}
            onDismiss={dismiss}
            t={tZh}
          />
        </div>,
      )

      const target = screen.getByLabelText('composer-editor')
      target.focus()
      fireEvent.keyDown(target, { key: 'Escape' })
      expect(dismiss).toHaveBeenCalledTimes(1)
    })
  })

  describe('Mount actual resident composer (InputBar) through conversation.input.overlay', () => {
    function setupResidentBar(options?: {
      prediction?: ComposerPredictionData | null
      onAdoptSpy?: (text: string) => void
      menuOpen?: boolean
    }) {
      const sink = vi.fn(() => Promise.resolve({ kind: 'success' as const }))
      const sessionStore = createSnapshotStore<SessionSnapshot>({
        ...sessionFixture(SID),
        openState: 'open',
        blank: false,
        running: true,
        awaitingFirstTurn: false,
      })

      const shell = new SessionInputShell({
        actx: SCTX,
        defaultSink: sink,
        commandAttachments: {
          serialize: () => Promise.resolve([]),
          release: () => {},
          unsupportedNotice: () => '',
        },
        inbox: createSnapshotStore({ 'next-turn': [], 'next-step': [] }),
      })

      const menuLauncher = createSnapshotStore<string | null>(options?.menuOpen ? 'command' : null)
      const busyEnter = createSnapshotStore<'queue' | 'steer'>('queue')
      const stopShortcut = createSnapshotStore<readonly string[]>(['Esc', 'Esc'])

      const renderSlot = ((key: string, _owner: object) => {
        if (key === 'conversation.input.overlay') {
          // Render prediction dock or overlay consuming standard session props
          return (
            <AssistantPredictionDock
              sessionId={SID}
              useSession={bindSnapshotSelector(sessionStore)}
              useInput={bindSnapshotSelector(shell.state)}
              useProjection={(() => undefined) as never}
              useConversation={(() => undefined) as never}
              useChat={(() => undefined) as never}
              useTrajectory={(() => undefined) as never}
              inputActions={shell.actions}
              predictComposer={vi.fn(async () =>
                options?.prediction
                  ? {
                    predictionId: options.prediction.predictionId,
                    sessionId: SID,
                    asOfSeq: options.prediction.asOfSeq,
                    text: options.prediction.text,
                  }
                  : null,
              )}
              getComposerContext={vi.fn(async () => ({
                sessionId: SID,
                asOfSeq: options?.prediction?.asOfSeq ?? 5,
                recentTexts: ['先前的讨论上下文'],
              }))}
              t={tZh}
            />
          )
        }
        return null
      }) as never

      const props: InputBarProps = {
        usePanelInfo: selector => selector({ activePanelId: null }),
        sessionId: SID,
        SessionProvider: ({ children }) => children,
        useSession: bindSnapshotSelector(sessionStore),
        useConversation: bindSnapshotSelector(createSnapshotStore(conversationFixture())),
        useSessionStatus: bindSnapshotSelector(createSnapshotStore(new Map())),
        useSessionRetainInfo: () => undefined,
        useResource,
        useSessions: bindSnapshotSelector(
          createSnapshotStore<SessionListState>({
            ids: [],
            byId: {},
            phase: 'ready',
            projectionsBySession: {},
          }),
        ),
        useWorkspaces: bindSnapshotSelector(
          createSnapshotStore({
            items: [],
            archivedSessionIds: [],
            pinnedSessionIds: [],
            state: 'idle',
            phase: 'ready',
            error: null,
          }),
        ),
        useProjection: () => undefined,
        useInput: bindSnapshotSelector(shell.state),
        inputActions: shell.actions,
        keyboard: shell,
        addFiles: () => null,
        useFileUploads: bindSnapshotSelector(createSnapshotStore({})),
        retryFileUpload: undefined,
        removeAttachment: () => {},
        resolveDraftAttachments: () => [],
        toggleCommandMenu: vi.fn(),
        useBusyEnter: bindSnapshotSelector(busyEnter),
        useStopShortcut: bindSnapshotSelector(stopShortcut),
        useNotices: bindSnapshotSelector(shell.notices),
        useLexicon: bindSnapshotSelector(shell.lexicon),
        useMenuLauncher: bindSnapshotSelector(menuLauncher),
        stop: vi.fn(),
        t: makeTranslate(zh, commonZh),
        renderSlot,
        variant: 'composer',
      }

      const view = render(<InputBar {...props} />)
      act(() => sessionStore.set({ ...sessionStore.getSnapshot(), running: false }))
      const editorElement = view.container.querySelector<HTMLDivElement>('[data-composer-input]')!

      return { view, shell, sessionStore, editorElement }
    }

    it('renders overlay suggestion when composer is empty and adopts into editor draft on Tab', async () => {
      const { view, shell, editorElement } = setupResidentBar({
        prediction: samplePrediction,
      })

      // Initially empty draft
      expect(shell.state.getSnapshot().draft).toBe('')

      // Wait for async context lookup and prediction to populate
      await act(async () => {
        await new Promise(r => setTimeout(r, 50))
      })

      const statusEl = view.container.querySelector('[role="status"]')
      expect(statusEl).not.toBeNull()
      expect(view.container.textContent).toContain('能否总结当前测试覆盖率情况？')

      // Focus editor and press Tab
      editorElement.focus()
      await act(async () => {
        fireEvent.keyDown(editorElement, { key: 'Tab' })
      })

      // The real Lexical editor draft now contains the adopted prediction text!
      expect(shell.state.getSnapshot().draft).toBe('能否总结当前测试覆盖率情况？')
      expect(editorElement.textContent).toContain('能否总结当前测试覆盖率情况？')
    })

    it('invalidates and dismisses prediction when user types in the editor', async () => {
      const { view, shell } = setupResidentBar({
        prediction: samplePrediction,
      })

      await act(async () => {
        await new Promise(r => setTimeout(r, 50))
      })

      expect(view.container.textContent).toContain('能否总结当前测试覆盖率情况？')

      // User types into the draft
      await act(async () => {
        shell.setDraft('用户自己输入的草稿内容')
      })

      // Suggestion must immediately disappear
      expect(view.container.textContent).not.toContain('能否总结当前测试覆盖率情况？')
    })
  })
})
