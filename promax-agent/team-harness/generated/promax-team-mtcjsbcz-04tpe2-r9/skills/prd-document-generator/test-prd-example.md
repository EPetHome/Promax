# 测试输入例子 - SkillHub技能数据同步需求

## 口述来源需求

### 一、同步skillhub.cn的技能数据到本地数据库

#### 具体要求
- 同步时，只同步安全检测为安全，无风险的技能数据。
- 同步时，下载skills的zip包，上传至本地EOS存储
- 每天同步一次
- 同步的技能数据，写入到现有的本地Tidb数据库中的algorithm_skill_info技能信息表，技能版本信息表algorithm_skill_version

## 表结构信息

algorithm_skill_version 技能版本信息表

| 字段名中文 | 字段名 | 类型 |
| ---------- | ------ | ---- |
| 技能ID           | skill_id             | varchar(128)  |
| 技能名称         | skill_name           | varchar(128)  |
| 技能展示名称     | skill_display_name   | varchar(128)  |
| 技能摘要描述     | summary              | varchar(4096) |
| 技能详细介绍     | detail_desc          | varchar(8000) |
| 技能类型         | skill_type           | tinyint       |
| 开源协议         | license              | varchar(50)   |
| 审核状态         | status               | tinyint       |
| 作者             | author_id            | varchar(50)   |
| 总下载量         | download_count       | bigint        |
| 预安装的技能标记 | default_install_flag | tinyint(1)    |
| 删除标记         | del_flag             | int           |
| 创建时间         | create_time          | datetime      |
| 更新时间         | update_time          | datetime      |
| 基础下载量       | default_base_count   | bigint        |
| 来源标识         | sourceType           | varchar(50)   |



用户技能关系表 algorithm_user_skill_relation
| 字段名中文 | 字段名 | 类型 |
| ---------- | ------ | ---- |
| ID                 | id                   | bigint        |
| 技能ID             | skill_id             | varchar(128)  |
| 技能名称           | skill_name           | varchar(128)  |
| 技能展示名称       | skill_display_name   | varchar(128)  |
| 技能摘要描述       | summary              | varchar(4096) |
| 版本ID             | version_id           | bigint        |
| 用户ID             | user_id              | long          |
| OpenClaw会员订单ID | open_order_id        | VARCHAR(128)  |
| 是否被禁用         | is_disabled          | tinyint       |
| 预安装的技能标记   | default_install_flag | tinyint(1)    |
| 删除标记           | del_flag             | int           |
| 创建时间           | create_time          | datetime      |
| 更新时间           | update_time          | datetime      |