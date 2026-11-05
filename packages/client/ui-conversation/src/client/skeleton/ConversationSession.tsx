/** Strict per-session header/body content inserted into the resident conversation layout. */

import clsx from 'clsx'
import { useLayoutEffect, useRef, useState } from 'react'
import { Menu, MenuItemButton, IconPinOutlineRegular, Tooltip, IconEllipsisOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { FIXED_VIEW_ID } from '../view-pins.ts'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import { resolveActiveView } from '../view-selection.ts'
import { DefaultConversationViews } from './DefaultConversationViews.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

/** Estimate whether a 13px label exceeds its header cell. */
function labelNeedsTooltip(label: string): boolean {
  return Array.from(label).reduce((size, glyph) => size + (/[^\u0000-\u00FF]/u.test(glyph) ? 13 : 7), 0) > 88
}

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns Session navigation controls, with title and tabs after conversation starts.
 */
export function ConversationSessionHeader({
  sessionId, hideChrome, useSessions, useConversationViews, useStore,
  renderSlot, open, selectView, setPinned, useEntryPins, t,
}: ConversationSessionHeaderProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const showTabs = !hideChrome && tabs.length > 1
  const unpinned = useEntryPins(ids => ids)
  const rowRef = useRef<HTMLDivElement>(null)
  const [limit, setLimit] = useState(Number.POSITIVE_INFINITY)
  const [moreOpen, setMoreOpen] = useState(false)
  useLayoutEffect(() => {
    const row = rowRef.current
    if (row === null) return
    const measure = (): void => {
      if (row.clientWidth > 0) setLimit(Math.max(1, Math.floor((row.clientWidth - 48) / 120)))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(row)
    return () => { observer?.disconnect() }
  }, [showTabs])
  const preferred = [...tabs.filter(tab => tab.id === FIXED_VIEW_ID),
    ...tabs.filter(tab => tab.id !== FIXED_VIEW_ID && !unpinned.includes(tab.id))]
  const visible = preferred.slice(0, limit)
  const closeMore = (): void => { setMoreOpen(false) }
  const openMoreView = (id: string): void => { selectView(id); closeMore() }
  const entries = tabs.filter(tab => tab.id !== FIXED_VIEW_ID).map(tab => ({
    id: tab.id, label: tab.label, active: tab.id === active?.id, pinned: !unpinned.includes(tab.id),
  }))
  return (
    <>
      <div className={css.titleRow}>
        {!hideChrome && (
          <>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  // The current crumb has no navigation, so it is plain text
                  // rather than a disabled button: on darwin desktop a button
                  // would subtract itself from the header's drag row (ui-web
                  // base.css) and leave the title inert for dragging too.
                  const title = last
                    ? (
                      <span className={clsx(css.crumb, summary.subagent && css.crumbSubagent, css.crumbCurrent)}>
                        {summary.displayTitle}
                      </span>
                    )
                    : (
                      <button
                        type="button"
                        className={clsx(css.crumb, summary.subagent && css.crumbSubagent)}
                        onClick={() => { open(summary.id) }}
                      >
                        {summary.displayTitle}
                      </button>
                    )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div className={css.headerUtilities}>
              {renderSlot('conversation.session.header.utilities', {})}
            </div>
          </>
        )}
        <div className={css.headerCorner} data-conversation-header-corner="">
          {renderSlot('conversation.session.header.corner', {})}
        </div>
      </div>
      {showTabs && (
        // data-conversation-tabs: marks the tab strip, which the window-chrome
        // geometry and the browser coverage lane anchor on.
        <div ref={rowRef} className={css.tabs} role="tablist" data-conversation-tabs="">
          {visible.map(viewTab => (
            <button
              key={viewTab.id}
              type="button"
              role="tab"
              aria-selected={viewTab.id === active?.id}
              className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
              onClick={() => { selectView(viewTab.id) }}
            >
              <Tooltip label={viewTab.label} portal disabled={!labelNeedsTooltip(viewTab.label)}>
                <span className={css.tabLabel}>{viewTab.label}</span>
              </Tooltip>
            </button>
          ))}
          {(entries.length > 0) && <Menu open={moreOpen} onClose={closeMore} portal autoFocus
            anchor={<button type="button" className={css.tab} aria-label={t('views.more')} aria-haspopup="menu"
              aria-expanded={moreOpen} onClick={() => { setMoreOpen(value => !value) }}><IconEllipsisOutlineRegular size={16} /></button>}>
            {renderSlot('conversation.session.header.views.actions', {
              entries, onOpen: openMoreView, onPinnedChange: setPinned, onDismiss: closeMore,
            }, { fallback: <>{entries.map(entry => <div key={entry.id} className={css.moreRow}>
              <MenuItemButton onSelect={() => { openMoreView(entry.id) }}>{entry.label}</MenuItemButton>
              <button type="button" className={css.pinToggle} aria-label={t(entry.pinned ? 'views.unpin' : 'views.pin', { name: entry.label })}
                aria-pressed={entry.pinned} onClick={() => { setPinned(entry.id, !entry.pinned) }}>
                <IconPinOutlineRegular size={16} />
              </button>
            </div>)}</> })}
          </Menu>}
        </div>
      )}
    </>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession(props: ConversationSessionProps) {
  return <DefaultConversationViews {...props} />
}
