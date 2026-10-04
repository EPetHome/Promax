# Intent Parser

## Purpose

Parse a natural language query into a structured intent object that drives the search and analysis workflow.

## Intent Types

| Intent | Identifier | Description |
|--------|-----------|-------------|
| `market_analysis` | Market analysis | User wants to understand a market/industry landscape |
| `product_deep_research` | Product deep dive | User wants comprehensive info about a single product |
| `product_competition` | Competitive analysis | User wants to compare products or find alternatives |

## Parsing Rules

### Market Analysis
Trigger keywords: `market`, `industry`, `landscape`, `overview`, `major players`, `市场`, `行业`, `主要厂商`, `竞品分析`

Example:
- Input: "AI email assistant market analysis"
- Output: `{ target_product: "AI email assistant", intent: "market_analysis" }`

### Product Deep Research
Default intent when:
- Query is a single product name (short, < 20 characters)
- No market/competition keywords present

Example:
- Input: "Superhuman email client"
- Output: `{ target_product: "Superhuman", intent: "product_deep_research" }`

### Competitive Comparison
Trigger keywords: `vs`, `compare`, `alternatives`, `competitors`, `对比`, `竞品`, `替代`, `类似`

Example:
- Input: "Superhuman vs Front email client"
- Output: `{ target_product: "Superhuman", intent: "product_competition" }`

## Product Name Extraction

1. Remove analysis-related suffixes from the query: `功能`, `特性`, `优势`, `对比`, `比较`, `分析`, `features`, `comparison`, `analysis`
2. Split on trigger keywords and take the part before them
3. Trim whitespace

**Examples:**
- "AI邮件助手功能对比" → target_product = "AI邮件助手"
- "project management tools comparison" → target_product = "project management tools"
- "Notion vs Obsidian" → target_product = "Notion"

## Output Format

```json
{
  "target_product": "string",
  "intent": "market_analysis | product_deep_research | product_competition",
  "original_query": "string"
}
```
