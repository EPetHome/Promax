import { render } from '@testing-library/react'
import { expect, it } from 'vitest'

import { MemberAvatar, PromaxLogo } from '../src/components/BrandAssets.tsx'

it('uses the matching supplied portrait in both member surfaces and keeps unknown members readable', () => {
  const memberIds = ['customer_research', 'product_discovery', 'requirement_management', 'solution_design', 'requirement_review', 'user_analysis']
  for (const className of ['agent-avatar', 'member-avatar']) {
    for (const memberId of memberIds) {
      const { container, unmount } = render(<MemberAvatar className={className} memberId={memberId} displayName="团队成员" />)
      expect(container.querySelector(`.${className} img`)).toHaveAttribute('src', expect.stringContaining(`${memberId}.png`))
      unmount()
    }
  }
  for (const memberId of ['custom-member', 'toString']) {
    const { container, unmount } = render(<MemberAvatar className="agent-avatar" memberId={memberId} displayName="自定义成员" />)
    expect(container).toHaveTextContent('自定')
    expect(container.querySelector('img')).toBeNull()
    unmount()
  }
  const { container } = render(<PromaxLogo className="brand-mark" />)
  expect(container.querySelector('img')).toHaveAttribute('src', expect.stringContaining('logo.png'))
})
