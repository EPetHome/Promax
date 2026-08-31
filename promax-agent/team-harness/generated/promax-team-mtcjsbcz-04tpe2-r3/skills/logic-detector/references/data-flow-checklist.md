<!-- PRD 逻辑检测 Skill 参考文件 - 数据流字段级一致性校验清单 -->

# 数据流字段级一致性校验清单

> 本清单用于对 PRD 中描述的数据流进行字段级别的全生命周期一致性追踪和校验。

---

## 一、数据生命周期追踪模型

### 1.1 六阶段模型

对每个数据实体，建立其全生命周期模型：

```
[输入] → [校验] → [转换/计算] → [存储] → [查询/读取] → [输出/展示]
```

| 阶段编号 | 阶段名 | 说明 | 在 PRD 中的典型位置 |
|---------|--------|------|-------------------|
| P1 | 输入 (Input) | 数据从何处进入系统 | 用户表单、API 请求、文件上传、外部系统推送 |
| P2 | 校验 (Validation) | 数据格式/合法性验证规则 | 校验规则描述、输入限制说明 |
| P3 | 转换 (Transform) | 数据被计算、转换、加工 | 业务逻辑描述、算法说明 |
| P4 | 存储 (Storage) | 数据在系统中的持久化形态 | 数据模型定义、数据库表结构、缓存策略 |
| P5 | 查询 (Query) | 数据被读取、检索的方式 | 查询条件描述、API 接口说明、搜索结果定义 |
| P6 | 输出 (Output) | 数据最终呈现给用户/下游系统 | 页面字段、接口响应、报表、推送消息 |

### 1.2 追踪模板

对每个实体，填写以下追踪矩阵：

```
实体名称：[ENTITY_NAME]

| 字段名 | P1-输入 | P2-校验 | P3-转换 | P4-存储 | P5-查询 | P6-输出 | 一致性 |
|--------|---------|---------|---------|---------|---------|---------|--------|
| field1 | 类型:T1 | 规则:V1 | 公式:F1 | 列:C1 | 条件:Q1 | 格式:O1 | ✅/❌   |
| field2 | 类型:T2 | 规则:V2 | -       | 列:C2 | -       | 格式:O2 | ✅/❌   |
| ...    | ...     | ...     | ...     | ...     | ...     | ...     | ...    |
```

**填写说明**：
- 每个单元格填写该字段在该阶段的具体定义（类型、格式、取值范围、必填性等）
- 如果该字段在某个阶段不存在/不出现，填写 `-`
- "一致性"列标注该字段在各阶段之间是否存在变形/缺失/矛盾

---

## 二、字段级一致性检查项

### 2.1 字段名一致性（DF-CHK-01）

**检查内容**：同一字段在不同阶段的名称是否一致。

**判定条件**：以下任一情况为不一致：
- 同一字段在 API 文档中叫 `user_id`，在数据库表中叫 `uid`
- 同一字段在 JSON 请求中叫 `phoneNumber`（驼峰），在响应中叫 `phone_number`（蛇形）
- 同一字段在前端展示时叫"用户编号"，后端接口中叫 `member_code`

**对应 Agent 检查项**：Q5 术语一致性

**对应问题模式**：P-55 数据流语义漂移

### 2.2 字段类型一致性（DF-CHK-02）

**检查内容**：同一字段在各阶段的类型定义是否一致。

**类型一致性判定表**：

| P1 输入类型 | P4 存储类型 | P6 输出类型 | 判定 |
|------------|------------|------------|------|
| String | VARCHAR | String | ✅ 一致 |
| Integer | INT | Number | ✅ 一致 |
| String | INT | Number | ❌ 类型冲突（String→INT） |
| Integer | VARCHAR | String | 🟡 隐式转换（需确认转换规则） |
| Boolean | TINYINT | Integer | 🟡 表示方式不同（需确认映射） |
| Date (ISO) | DATETIME | String (Unix) | 🟡 格式不同（需确认格式转换规则） |

**对应 Agent 检查项**：Q6 数据一致性

**对应问题模式**：P-47 数据流字段变形

### 2.3 字段取值范围一致性（DF-CHK-03）

**检查内容**：同一字段在各阶段的取值约束是否一致。

**取值范围约束项**：

- 数值范围：[min, max] 是否在各阶段一致
- 枚举值：允许的值集合是否一致
- 字符串长度：最大长度是否一致
- 精度：小数位数是否一致
- 可选值：NULL / 空字符串 / 默认值 是否一致

**对应 Agent 检查项**：Q8 边界值定义

**对应问题模式**：P-42 范围冲突

### 2.4 字段必填性一致性（DF-CHK-04）

**检查内容**：同一字段的必填/可选属性在各阶段是否一致。

**判定条件**：
- 输入阶段必填 + 输出阶段不存在 → 🔴致命（数据丢失）
- 输入阶段可选 + 输出阶段必填 → 🟡警告（需确认空值时的行为）
- 存储阶段 NOT NULL + 输入阶段可选 → 🟡警告（需确认默认值策略）

**对应 Agent 检查项**：Q6 数据一致性

**对应问题模式**：P-48 数据流字段缺失

### 2.5 字段默认值一致性（DF-CHK-05）

**检查内容**：同一字段的默认值定义在各阶段是否一致。

**判定条件**：
- 输入层默认值 A + 存储层默认值 B + A ≠ B → 冲突
- 存储层默认值 + 查询层返回的值与默认值不符 → 逻辑矛盾

---

## 三、接口与业务描述对齐检查

### 3.1 API 字段存在性检查（DF-CHK-06）

**检查内容**：业务描述中提到的字段是否在 API 定义中出现（以及反向检查）。

**正向检查**（业务→API）：
```
对业务描述中每个「字段名」：
  在 API 请求/响应定义中查找同名字段
  如果找不到 → 标记为"API 缺失字段"
```

**反向检查**（API→业务）：
```
对 API 响应中的每个字段：
  在业务描述中查找该字段的用途说明
  如果找不到 → 标记为"未定义用途字段"（可能是内部字段，需标注）
```

### 3.2 API 字段与数据模型一致性（DF-CHK-07）

**检查内容**：API 文档中的字段与数据模型（数据库表/缓存结构）中的字段是否一致。

**检查项**：

| 检查维度 | 判定条件 | 严重度 |
|---------|---------|--------|
| 字段名映射 | API 字段名 vs 数据库列名：是否有一一映射？映射规则是否明确？ | 🟡警告 |
| 字段覆盖 | 数据库字段是否都在 API 的某处有体现？（不是所有数据库字段都要暴露，但要确认有意识的隐藏） | 💡建议 |
| 字段冗余 | API 响应的字段数量是否过多？（潜在性能问题） | 💡建议 |

**对应 Agent 检查项**：Q6 数据一致性（功能描述与数据模型一致）

### 3.3 字段来源追溯（DF-CHK-08）

**检查内容**：API 响应中的每个字段是否能追溯到明确的数据来源。

**追溯算法**：
```
对 API 响应中的每个字段 F：
  1. 检查 F 是否在 P4-存储阶段定义
     是 → 来源明确（数据库字段）
     否 → 检查 F 是否在 P3-转换阶段被计算
           是 → 来源明确（计算字段）
           否 → 标记为"未定义来源"（🚩 P-49）
```

**对应问题模式**：P-49 数据流未定义来源

---

## 四、数据流断裂识别模式

### 4.1 断裂模式 1：字段凭空出现（Field Appears Out of Nowhere）

**模式描述**：字段在输出/API 响应中出现，但在输入和转换阶段均无定义。

**检测方法**：
```
output_fields = 提取 P6 阶段的所有字段名
input_fields = 提取 P1 阶段的所有字段名
transform_fields = 提取 P3 阶段的所有计算输出字段名
storage_fields = 提取 P4 阶段的所有数据库字段名

forall f in output_fields:
  if f not in (input_fields ∪ transform_fields ∪ storage_fields):
    标记 (f, "未定义来源")
```

**PRD 示例**：
> API 响应中包含"用户信用评分"字段，但 PRD 中未说明该字段从哪里计算、存储在哪里。

**对应问题模式**：P-49

### 4.2 断裂模式 2：字段中途消失（Field Disappears Midway）

**模式描述**：字段在输入阶段存在，在存储阶段也存在，但在输出阶段消失——且业务逻辑上该字段应该被输出。

**检测方法**：
```
forall f in input_fields:
  if f in storage_fields AND f not in output_fields:
    if 业务上 f 应该被展示/返回:
      标记 (f, "字段中途消失")
```

**PRD 示例**：
> 用户注册时填写了"推荐人ID"，数据库中存储了 referrer_id，但用户信息页面不展示。

**对应问题模式**：P-48

### 4.3 断裂模式 3：字段语义漂移（Semantic Drift）

**模式描述**：同一字段名在数据流的不同阶段含义发生了变化。

**检测方法**：
```
对字段 F 在各阶段的定义/描述进行比较：
  if F 在阶段 A 的描述与 F 在阶段 B 的描述指代不同内容：
    标记 (F, "语义漂移", A, B)
```

**PRD 示例**：
> P1 阶段："status 表示订单状态（待支付/已支付等）"
> P6 阶段："status 表示物流状态（运输中/已签收等）"

**对应问题模式**：P-55

---

## 五、数据流一致性检查清单汇总

### 5.1 字段级检查（对所有追踪字段执行）

| 检查编号 | 检查项 | 判定公式 | 对应 P-编号 |
|---------|--------|---------|------------|
| DF-CHK-01 | 字段名一致 | ∀阶段A,B: name(f, A) == name(f, B) | P-55 |
| DF-CHK-02 | 类型一致 | ∀阶段A,B: type(f, A) ≅ type(f, B) | P-47 |
| DF-CHK-03 | 取值范围一致 | ∀阶段A,B: range(f, A) ∩ range(f, B) ≠ ∅ | P-42 |
| DF-CHK-04 | 必填性一致 | required(f, P1) → exists(f, P6) | P-48 |
| DF-CHK-05 | 默认值一致 | default(f, P1) == default(f, P4) OR default(f, P1) 覆盖 default(f, P4) | - |
| DF-CHK-06 | API字段存在 | ∀f ∈ 业务描述字段: f ∈ API定义字段 | P-51 |
| DF-CHK-07 | API与模型一致 | ∀f ∈ API响应字段: f ∈ 数据模型字段 | P-51 |
| DF-CHK-08 | 字段来源可追溯 | ∀f ∈ P6输出字段: f ∈ (P1 ∪ P3 ∪ P4) | P-49 |

### 5.2 阶段级检查（跨阶段对比）

| 检查编号 | 检查项 | 判定公式 | 对应 P-编号 |
|---------|--------|---------|------------|
| DF-CHK-10 | P1→P4 存储完整性 | ∀f ∈ P1输入字段: f ∈ P4存储字段 OR f为短暂字段（无需持久化且有明确说明） | P-48 |
| DF-CHK-11 | P4→P6 输出闭环 | ∀f ∈ P1输入字段: f ∈ P6输出字段 OR 有明确说明 f 为内部字段不对外暴露 | P-50 |
| DF-CHK-12 | P1→P6 全链路 | 对关键实体，所有核心字段必须可全链路追踪 | P-50 |

### 5.3 实体级检查

| 检查编号 | 检查项 | 判定条件 |
|---------|--------|---------|
| DF-CHK-15 | 实体完整性 | 每个数据实体的所有属性都在数据模型中有定义 |
| DF-CHK-16 | 关联完整性 | 实体间的关联（外键、多对多关系等）在数据模型中有对应定义 |
| DF-CHK-17 | 生命周期完整性 | 数据从创建到归档/删除的全生命周期链路完整，无断裂 |

---

## 六、数据流校验伪代码

```python
class DataFlowValidator:
    """数据流字段级一致性校验器"""

    def build_tracking_matrix(self, prd_text: str, entity_name: str) -> dict:
        """
        为指定实体构建字段追踪矩阵
        返回: {field_name: {P1: {...}, P2: {...}, ..., P6: {...}}}
        """
        matrix = {}
        stages = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']

        # 从 PRD 各章节提取字段定义
        field_defs = self.extract_field_definitions(prd_text, entity_name)

        for field, definitions in field_defs.items():
            matrix[field] = {}
            for stage in stages:
                matrix[field][stage] = definitions.get(stage, None)

        return matrix

    def check_field_consistency(self, matrix: dict) -> list[Issue]:
        """对追踪矩阵中的每个字段进行一致性检查"""
        issues = []

        for field, stages in matrix.items():
            # DF-CHK-01: 字段名一致性
            issues.extend(self.check_name_consistency(field, stages))

            # DF-CHK-02: 类型一致性
            issues.extend(self.check_type_consistency(field, stages))

            # DF-CHK-03: 取值范围一致性
            issues.extend(self.check_range_consistency(field, stages))

            # DF-CHK-04: 必填性一致性
            issues.extend(self.check_required_consistency(field, stages))

            # DF-CHK-05: 默认值一致性
            issues.extend(self.check_default_consistency(field, stages))

        return issues

    def check_type_consistency(self, field: str, stages: dict) -> list[Issue]:
        """
        检查字段在各阶段的类型是否一致
        使用类型兼容性矩阵进行判定
        """
        TYPE_COMPATIBILITY = {
            ('String', 'VARCHAR'): 'compatible',
            ('String', 'TEXT'): 'compatible',
            ('Integer', 'INT'): 'compatible',
            ('Integer', 'BIGINT'): 'compatible',
            ('Float', 'DECIMAL'): 'compatible',
            ('Boolean', 'TINYINT'): 'implicit_conversion',
            ('String', 'INT'): 'incompatible',       # ❌ 致命
            ('Integer', 'VARCHAR'): 'incompatible',   # ❌ 致命
            ('Date', 'BIGINT'): 'implicit_conversion',
        }

        issues = []
        stage_names = list(stages.keys())
        for i in range(len(stage_names)):
            for j in range(i + 1, len(stage_names)):
                s1, s2 = stage_names[i], stage_names[j]
                if stages[s1] and stages[s2]:
                    t1 = stages[s1].get('type')
                    t2 = stages[s2].get('type')
                    if t1 and t2 and t1 != t2:
                        compat = TYPE_COMPATIBILITY.get((t1, t2)) or \
                                 TYPE_COMPATIBILITY.get((t2, t1))
                        if compat == 'incompatible':
                            issues.append(Issue(
                                severity='🔴致命',
                                field=field,
                                stages=(s1, s2),
                                types=(t1, t2),
                                pattern='P-47',
                                description=f'字段 {field} 类型在 {s1}({t1}) 和 {s2}({t2}) 不一致'
                            ))
                        elif compat == 'implicit_conversion':
                            issues.append(Issue(
                                severity='🟡警告',
                                field=field,
                                stages=(s1, s2),
                                types=(t1, t2),
                                pattern='P-47',
                                description=f'字段 {field} 在 {s1}({t1})→{s2}({t2}) 存在隐式类型转换，需确认转换规则'
                            ))
        return issues

    def detect_orphan_outputs(self, output_fields: set, input_fields: set,
                               transform_fields: set, storage_fields: set) -> list[Issue]:
        """检测未定义来源的输出字段（P-49）"""
        defined = input_fields | transform_fields | storage_fields
        orphans = output_fields - defined
        return [
            Issue(
                severity='🟡警告',
                field=f,
                pattern='P-49',
                description=f'输出字段 {f} 在输入/转换/存储阶段均无定义来源'
            ) for f in orphans
        ]

    def detect_missing_outputs(self, input_fields: set, storage_fields: set,
                                output_fields: set, business_visible: callable) -> list[Issue]:
        """检测应输出但未输出的字段（P-48）"""
        missing = []
        for f in input_fields & storage_fields:  # 既要输入又要存储
            if f not in output_fields and business_visible(f):
                missing.append(Issue(
                    severity='🟡警告',
                    field=f,
                    pattern='P-48',
                    description=f'字段 {f} 在输入和存储阶段存在，但在输出阶段缺失'
                ))
        return missing

    def detect_semantic_drift(self, field_stages: dict) -> list[Issue]:
        """检测语义漂移（P-55）"""
        issues = []
        for field, stages in field_stages.items():
            descriptions = {}
            for stage, info in stages.items():
                if info and 'description' in info:
                    descriptions[stage] = info['description']

            # 两两比较不同阶段的描述
            stage_names = list(descriptions.keys())
            for i in range(len(stage_names)):
                for j in range(i + 1, len(stage_names)):
                    d1 = descriptions[stage_names[i]]
                    d2 = descriptions[stage_names[j]]
                    # 如果描述的关键实体不同 → 语义漂移
                    entities_1 = self.extract_entities(d1)
                    entities_2 = self.extract_entities(d2)
                    if entities_1 and entities_2 and entities_1 != entities_2:
                        issues.append(Issue(
                            severity='🟡警告',
                            field=field,
                            pattern='P-55',
                            stages=(stage_names[i], stage_names[j]),
                            description=f'字段 {field} 在 {stage_names[i]} 指"{d1}"，在 {stage_names[j]} 指"{d2}"，含义可能不同'
                        ))
        return issues

    def extract_entities(self, text: str) -> set:
        """从描述文本中提取核心实体词"""
        entity_keywords = ['订单', '用户', '商品', '支付', '物流', '账户', '评论', '任务']
        return {kw for kw in entity_keywords if kw in text}
```

---

## 七、数据流校验结果输出格式

```markdown
## 数据流校验结果

### 实体：[实体名称]

#### 字段追踪矩阵

| 字段名 | P1-输入 | P2-校验 | P3-转换 | P4-存储 | P5-查询 | P6-输出 | 一致性 |
|--------|---------|---------|---------|---------|---------|---------|--------|
| field1 | String(50) | 非空 | - | VARCHAR(50) | = | String(50) | ✅ |
| field2 | Integer | 1-100 | ×2 | INT | - | Number | 🟡隐式转换 |

#### 断裂点清单

| 断裂点 | 位置 | 字段 | 问题模式 | 严重度 |
|--------|------|------|---------|--------|
| P3→P4 | 第X章 vs 第Y章 | field3 | P-47 类型变形 | 🔴致命 |
| P4→P6 | 第Z章 | field4 | P-48 字段缺失 | 🟡警告 |

#### 未定义来源字段

| 字段名 | 出现位置 | 分析 | 建议 |
|--------|---------|------|------|
| credit_score | 第Y章 API响应 | 输入/转换/存储中均无此字段的定义 | 补充字段来源说明 |
```
