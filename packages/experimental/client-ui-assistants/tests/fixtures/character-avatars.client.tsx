/** Browser fixture for the actual avatar components and theme, with no Host mutations. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AvatarPicker, DEFAULT_AVATAR, EntityAvatar } from '../../src/client/EntityAvatar.tsx'
import { zh, type AssistantLocaleKey } from '../../src/client/locales.ts'
import '../../../../client/ui-theme/src/styles/design-platform.css'
import './character-avatars.css'

const t = (key: AssistantLocaleKey) => zh[key]
const variants = ['sea-whale', 'sea-seal', 'sea-seal-apricot', 'bot-sprout', 'bot-coral']

function Preview() {
  const [value, setValue] = useState(DEFAULT_AVATAR)
  const [dark, setDark] = useState(false)
  return (
    <main>
      <header>
        <div>
          <p>Little Green Whale · Avatar collection</p>
          <h1>小伙伴，来报到。</h1>
        </div>
        <button
          onClick={() => {
            document.body.toggleAttribute('data-ds-dark-theme', !dark)
            setDark(!dark)
          }}
        >
          切换主题
        </button>
      </header>
      <div className="preview-grid">
        <section className="portrait-sheet">
          <h2>
            海边小伙伴 <small>默认系列</small>
          </h2>
          <p>小绿鲸 · 小海豹 · 杏桃海豹</p>
          <div className="large-portraits">
            {variants.slice(0, 3).map(id => (
              <EntityAvatar key={id} name={id} avatar={`character:${id}`} />
            ))}
          </div>
          <h2>
            软萌机器人 <small>可选系列</small>
          </h2>
          <p>鼠尾草 · 珊瑚</p>
          <div className="large-portraits">
            {variants.slice(3).map(id => (
              <EntityAvatar key={id} name={id} avatar={`character:${id}`} />
            ))}
          </div>
          <h3>真实界面尺寸</h3>
          <div className="sizes">
            {variants.map(id => (
              <EntityAvatar key={id} name={id} avatar={`character:${id}`} />
            ))}
          </div>
          <div className="sizes">
            {variants.map(id => (
              <EntityAvatar key={id} name={id} avatar={`character:${id}`} small />
            ))}
          </div>
          <div className="entity-row">
            <EntityAvatar name="项目助理" avatar={value} />
            <div>
              <strong>项目助理</strong>
              <p>陪你把事情做好</p>
            </div>
          </div>
        </section>
        <section className="picker-card">
          <h2>选择一个小伙伴</h2>
          <AvatarPicker name="项目助理" value={value} onChange={setValue} t={t} />
          <output data-testid="selection">{value}</output>
        </section>
      </div>
    </main>
  )
}
const root = document.getElementById('root')
if (!root) throw new Error('Missing preview root')
createRoot(root).render(<Preview />)
