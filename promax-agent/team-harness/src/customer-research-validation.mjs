const REQUIRED_HEADINGS = Array.from({ length: 11 }, (_, index) => `## ${index} ${[
  '交付状态',
  '输入证据清单',
  '样本与场景',
  '样本边界与外推限制',
  '访谈摘要',
  '关键发现',
  '痛点与候选需求',
  '证据追溯矩阵',
  '矛盾、缺口与未验证项',
  '下游移交',
  '逐项自检',
][index]}`)

function issue(code, message, evidence = {}) {
  return { code, message, evidence }
}

function section(text, startIndex, endIndex) {
  const start = text.indexOf(`${REQUIRED_HEADINGS[startIndex]}\n`)
  if (start < 0) return ''
  const contentStart = start + REQUIRED_HEADINGS[startIndex].length + 1
  const next = endIndex === undefined ? text.length : text.indexOf(`${REQUIRED_HEADINGS[endIndex]}\n`, contentStart)
  return text.slice(contentStart, next < 0 ? text.length : next)
}

function markdownRows(text) {
  return text.split(/\r?\n/).filter(line => /^\s*\|.*\|\s*$/.test(line)).map(line => line.trim())
}

function cells(row) {
  return row.slice(1, -1).split('|').map(value => value.trim())
}

function isSeparator(row) {
  return cells(row).every(value => /^:?-{3,}:?$/.test(value))
}

export function validateCustomerResearchReport(text) {
  const issues = []
  if (typeof text !== 'string' || !text.trim()) {
    return { valid: false, issues: [issue('CUSTOMER_RESEARCH_EMPTY', '客户研究报告为空。')] }
  }

  let previous = -1
  for (const heading of REQUIRED_HEADINGS) {
    const index = text.indexOf(`${heading}\n`)
    if (index < 0) issues.push(issue('CUSTOMER_RESEARCH_HEADING_MISSING', `缺少固定标题：${heading}`, { heading }))
    else if (index <= previous) issues.push(issue('CUSTOMER_RESEARCH_HEADING_ORDER', `固定标题顺序错误：${heading}`, { heading }))
    else previous = index
  }

  if (issues.some(item => item.code.startsWith('CUSTOMER_RESEARCH_HEADING_'))) {
    return { valid: false, issues }
  }

  const conclusions = `${section(text, 5, 6)}\n${section(text, 6, 7)}`
  const conclusionIds = [...new Set(conclusions.match(/\b(?:F|P|N)-\d{3}\b/g) ?? [])]
  for (const id of conclusionIds) {
    const line = conclusions.split(/\r?\n/).find(candidate => candidate.includes(id)) ?? ''
    if (!/\bE-\d{3}\b/.test(line)) {
      issues.push(issue('CUSTOMER_RESEARCH_CONCLUSION_EVIDENCE_MISSING', `${id} 所在行没有直接引用 E-*。`, { conclusion_id: id, line }))
    }
  }

  const trace = section(text, 7, 8)
  for (const id of conclusionIds) {
    const row = markdownRows(trace).find(candidate => candidate.includes(id)) ?? ''
    if (!row || !/\bE-\d{3}\b/.test(row) || !/\bSRC-\d{3}\b/.test(row)) {
      issues.push(issue('CUSTOMER_RESEARCH_TRACE_UNMAPPED', `${id} 未在追溯矩阵同时映射 E-* 与 SRC-*。`, { conclusion_id: id, row }))
    }
  }

  const boundaryRows = markdownRows(section(text, 3, 4))
  const headerIndex = boundaryRows.findIndex(row => {
    const values = cells(row)
    return ['结论编号', 'observed_count', 'sample_size', '计算式', '允许表述', '禁止表述'].every(name => values.includes(name))
  })
  if (headerIndex < 0) {
    issues.push(issue('CUSTOMER_RESEARCH_BOUNDARY_HEADER_MISSING', '样本边界实际代入表缺少规定列。'))
  } else {
    const header = cells(boundaryRows[headerIndex])
    const observedIndex = header.indexOf('observed_count')
    const sampleIndex = header.indexOf('sample_size')
    const dataRows = boundaryRows.slice(headerIndex + 1).filter(row => !isSeparator(row))
    if (!dataRows.length) issues.push(issue('CUSTOMER_RESEARCH_BOUNDARY_ROWS_MISSING', '样本边界实际代入表没有数据行。'))
    for (const row of dataRows) {
      const values = cells(row)
      const observed = values[observedIndex]
      const sample = values[sampleIndex]
      const bothUnknown = observed === '未提供' && sample === '未提供'
      const bothIntegers = /^\d+$/.test(observed ?? '') && /^\d+$/.test(sample ?? '')
      if (!bothUnknown && !bothIntegers) {
        issues.push(issue('CUSTOMER_RESEARCH_SAMPLE_FORMAT', 'observed_count 与 sample_size 必须同时为非负整数或同时为“未提供”。', { row }))
      } else if (bothIntegers && Number(observed) > Number(sample)) {
        issues.push(issue('CUSTOMER_RESEARCH_SAMPLE_OVERFLOW', 'observed_count 不能大于 sample_size。', { row, observed_count: Number(observed), sample_size: Number(sample) }))
      }
    }
  }

  const productionSections = `${section(text, 4, 5)}\n${section(text, 5, 6)}\n${section(text, 6, 7)}\n${section(text, 9, 10)}`
  for (const line of productionSections.split(/\r?\n/)) {
    if (/(总体客户|所有客户|普遍客户|大多数客户)/.test(line) && !/(不代表|不得|禁止|不能|未验证|不可)/.test(line)) {
      issues.push(issue('CUSTOMER_RESEARCH_POPULATION_EXTRAPOLATION', '发现未加限制的总体外推表述。', { line }))
    }
  }

  const selfCheck = section(text, 10)
  for (let index = 1; index <= 9; index += 1) {
    const id = `CR-${String(index).padStart(2, '0')}`
    if (!selfCheck.includes(id)) issues.push(issue('CUSTOMER_RESEARCH_SELF_CHECK_MISSING', `逐项自检缺少 ${id}。`, { self_check_id: id }))
  }

  return { valid: issues.length === 0, issues }
}

export { REQUIRED_HEADINGS as CUSTOMER_RESEARCH_REQUIRED_HEADINGS }
