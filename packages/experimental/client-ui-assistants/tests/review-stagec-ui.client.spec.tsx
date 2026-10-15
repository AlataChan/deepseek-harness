// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ComposerPrediction } from '../src/client/ComposerPrediction.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
it('discards a suggestion after typing instead of resurrecting it when the draft is cleared',()=>{
  const props={ prediction:{ predictionId:'old',text:'OLD_PREDICTION',asOfSeq:5 },currentSeq:5,onAdopt:vi.fn(),onDismiss:vi.fn(),t:makeTranslate(zh) }
  const view=render(<ComposerPrediction {...props} draftText="" />)
  try{expect(screen.getByText('OLD_PREDICTION')).toBeDefined();view.rerender(<ComposerPrediction {...props} draftText="user typed" />);view.rerender(<ComposerPrediction {...props} draftText="" />);expect(screen.queryByText('OLD_PREDICTION')).toBeNull()}finally{cleanup()}
})
