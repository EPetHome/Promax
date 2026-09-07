import logo from '../assets/logo.png'
import customerResearch from '../assets/customer_research.png'
import productDiscovery from '../assets/product_discovery.png'
import requirementManagement from '../assets/requirement_management.png'
import solutionDesign from '../assets/solution_design.png'
import requirementReview from '../assets/requirement_review.png'
import userAnalysis from '../assets/user_analysis.png'

const memberPortraits: Readonly<Record<string, string>> = {
  customer_research: customerResearch,
  product_discovery: productDiscovery,
  requirement_management: requirementManagement,
  solution_design: solutionDesign,
  requirement_review: requirementReview,
  user_analysis: userAnalysis,
}

export function PromaxLogo({ className }: { className: string }) {
  return <img className={className} src={logo} width={34} height={34} alt="" aria-hidden="true" />
}

export function MemberAvatar({ memberId, displayName, className }: { memberId: string; displayName: string; className: string }) {
  const portrait = Object.hasOwn(memberPortraits, memberId) ? memberPortraits[memberId] : undefined
  return <span className={className} aria-hidden="true">{portrait === undefined
    ? displayName.slice(0, 2)
    : <img src={portrait} width={38} height={38} alt="" />}</span>
}
