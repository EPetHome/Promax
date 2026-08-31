#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
核心业务指标分析脚本

分析核心业务指标的趋势、异常、量价背离等，生成综合分析报告。
支持指标：DAU、MAU、上传用户数、下载用户数、上传容量、下载容量等。

用法:
    python analyze_core_metrics.py --input data.json --output report.md
    python analyze_core_metrics.py --input data.json --detect-anomalies --threshold 2.5
    python analyze_core_metrics.py --input data.json --analysis divergence --json
    python analyze_core_metrics.py --input data.json --metrics dau,upload_users --period 60
"""

import argparse
import json
import math
import sys
from datetime import datetime


class CoreMetricsAnalyzer:
    """核心业务指标分析器"""

    # 指标中文名称映射
    METRIC_NAMES = {
        "dau": "日活跃用户数",
        "mau": "月活跃用户数",
        "upload_users": "上传用户数",
        "download_users": "下载用户数",
        "upload_capacity": "上传容量",
        "download_capacity": "下载容量",
    }

    # 用户类指标（用于背离分析）
    USER_METRICS = ["upload_users", "download_users"]
    # 容量类指标（用于背离分析）
    CAPACITY_METRICS = ["upload_capacity", "download_capacity"]
    # 用户-容量对应关系（用于背离分析）
    DIVERGENCE_PAIRS = [
        ("upload_users", "upload_capacity"),
        ("download_users", "download_capacity"),
    ]

    # 趋势方向阈值（变化幅度超过此百分比才判定为上升/下降）
    TREND_THRESHOLD = 5.0
    # 背离幅度阈值（用户与容量WoW变化差异超过此百分比判定为显著背离）
    DIVERGENCE_THRESHOLD = 20.0

    def __init__(self, data, metrics=None, period=30, detect_anomalies=False,
                 threshold=2.0, analysis=None, report_type=None):
        """
        初始化分析器

        Args:
            data: 原始数据字典，key为指标名，value为[{date, value}, ...]列表
            metrics: 指定的指标列表，None表示分析全部可用指标
            period: 分析周期（截取最近多少天的数据）
            detect_anomalies: 是否检测异常
            threshold: 异常检测阈值（z-score）
            analysis: 分析类型（如"divergence"量价背离分析）
            report_type: 报告类型（daily/weekly/monthly）
        """
        self.raw_data = data if data else {}
        self.requested_metrics = metrics
        self.period = period
        self.detect_anomalies = detect_anomalies
        self.threshold = threshold
        self.analysis = analysis
        self.report_type = report_type

        # 解析后的数据：{metric_name: [{date, value}, ...]}
        self.parsed_data = {}
        # 实际分析的指标列表
        self.analyze_metrics = []
        # 各指标分析结果
        self.results = {}
        # 背离分析结果
        self.divergence_results = {}
        # 派生指标
        self.derived_metrics = {}
        # 综合分析结果
        self.comprehensive = {}

    # ------------------------------------------------------------------
    # 数据解析与预处理
    # ------------------------------------------------------------------

    def parse_data(self):
        """解析和验证输入数据，截取指定周期内的数据"""
        if not self.raw_data:
            raise ValueError("输入数据为空")

        if not isinstance(self.raw_data, dict):
            raise ValueError("输入数据格式错误：期望JSON对象（字典）")

        # 支持两种格式：1) 顶层直接是指标字典 2) 嵌套在 "metrics" 键下
        metrics_dict = self.raw_data
        if "metrics" in self.raw_data and isinstance(self.raw_data["metrics"], dict):
            metrics_dict = self.raw_data["metrics"]

        for metric_name, data_points in metrics_dict.items():
            if not isinstance(data_points, list):
                print(f"警告: 指标 '{metric_name}' 的数据不是列表格式，已跳过",
                      file=sys.stderr)
                continue

            if len(data_points) == 0:
                print(f"警告: 指标 '{metric_name}' 的数据为空列表，已跳过",
                      file=sys.stderr)
                continue

            parsed_points = []
            for point in data_points:
                if not isinstance(point, dict):
                    continue
                if "date" not in point or "value" not in point:
                    continue
                try:
                    value = float(point["value"])
                    date_str = str(point["date"])
                    parsed_points.append({"date": date_str, "value": value})
                except (ValueError, TypeError):
                    continue

            if len(parsed_points) == 0:
                print(f"警告: 指标 '{metric_name}' 没有有效数据点，已跳过",
                      file=sys.stderr)
                continue

            # 按日期排序（字符串日期假设为ISO格式 YYYY-MM-DD）
            parsed_points.sort(key=lambda x: x["date"])

            # 截取最近 period 天的数据
            if len(parsed_points) > self.period:
                parsed_points = parsed_points[-self.period:]

            self.parsed_data[metric_name] = parsed_points

        if not self.parsed_data:
            raise ValueError("解析后无有效数据，请检查输入文件格式")

        # 确定要分析的指标
        if self.requested_metrics:
            # 只分析指定的指标（且数据中存在的）
            self.analyze_metrics = [
                m for m in self.requested_metrics if m in self.parsed_data
            ]
            missing = [
                m for m in self.requested_metrics if m not in self.parsed_data
            ]
            if missing:
                print(f"警告: 以下指标在数据中不存在或无效: {', '.join(missing)}",
                      file=sys.stderr)
            if not self.analyze_metrics:
                raise ValueError("指定的指标均不存在于数据中")
        else:
            self.analyze_metrics = list(self.parsed_data.keys())

    # ------------------------------------------------------------------
    # 统计计算
    # ------------------------------------------------------------------

    def calculate_statistics(self, values):
        """
        计算统计指标：最小值、最大值、均值、中位数、标准差

        Args:
            values: 数值列表

        Returns:
            统计信息字典
        """
        if not values:
            return {
                "min": None, "max": None,
                "mean": None, "median": None, "stdev": None,
            }

        n = len(values)
        min_val = min(values)
        max_val = max(values)
        mean_val = sum(values) / n

        # 中位数
        sorted_vals = sorted(values)
        if n % 2 == 0:
            median_val = (sorted_vals[n // 2 - 1] + sorted_vals[n // 2]) / 2
        else:
            median_val = sorted_vals[n // 2]

        # 样本标准差（n-1自由度）
        if n > 1:
            variance = sum((v - mean_val) ** 2 for v in values) / (n - 1)
            stdev_val = math.sqrt(variance)
        else:
            stdev_val = 0.0

        return {
            "min": round(min_val, 2),
            "max": round(max_val, 2),
            "mean": round(mean_val, 2),
            "median": round(median_val, 2),
            "stdev": round(stdev_val, 2),
        }

    # ------------------------------------------------------------------
    # 趋势计算
    # ------------------------------------------------------------------

    def calculate_trend(self, data_points):
        """
        计算趋势指标：周环比(WoW)、月环比(MoM)、总变化率、趋势方向

        Args:
            data_points: [{date, value}, ...] 已按日期排序的数据点列表

        Returns:
            趋势信息字典
        """
        values = [p["value"] for p in data_points]
        n = len(values)

        result = {
            "wow_change": None,
            "mom_change": None,
            "total_change": None,
            "trend_direction": "unknown",
        }

        if n == 0:
            return result

        if n == 1:
            # 只有一个数据点，无法计算趋势
            result["trend_direction"] = "stable"
            return result

        # --- 总变化率：(最后一个 - 第一个) / |第一个| ---
        first_val = values[0]
        last_val = values[-1]
        if first_val != 0:
            total_change = ((last_val - first_val) / abs(first_val)) * 100
            result["total_change"] = round(total_change, 2)
        else:
            # 首值为零的特殊情况
            if last_val > 0:
                result["total_change"] = 100.0
            elif last_val < 0:
                result["total_change"] = -100.0
            else:
                result["total_change"] = 0.0

        # --- 周环比 WoW：最近7天均值 vs 上一个7天均值 ---
        if n >= 14:
            current_week = values[-7:]
            previous_week = values[-14:-7]
            prev_avg = sum(previous_week) / len(previous_week)
            curr_avg = sum(current_week) / len(current_week)
            if prev_avg != 0:
                wow = ((curr_avg - prev_avg) / abs(prev_avg)) * 100
                result["wow_change"] = round(wow, 2)
            else:
                result["wow_change"] = 100.0 if curr_avg > 0 else (
                    -100.0 if curr_avg < 0 else 0.0
                )
        elif n >= 2:
            # 数据不足14天，用前后半部分比较近似WoW
            mid = n // 2
            first_half = values[:mid]
            second_half = values[mid:]
            if first_half and second_half:
                prev_avg = sum(first_half) / len(first_half)
                curr_avg = sum(second_half) / len(second_half)
                if prev_avg != 0:
                    wow = ((curr_avg - prev_avg) / abs(prev_avg)) * 100
                    result["wow_change"] = round(wow, 2)
                else:
                    result["wow_change"] = 100.0 if curr_avg > 0 else (
                        -100.0 if curr_avg < 0 else 0.0
                    )

        # --- 月环比 MoM：最近30天均值 vs 上一个30天均值 ---
        if n >= 60:
            current_month = values[-30:]
            previous_month = values[-60:-30]
            prev_avg = sum(previous_month) / len(previous_month)
            curr_avg = sum(current_month) / len(current_month)
            if prev_avg != 0:
                mom = ((curr_avg - prev_avg) / abs(prev_avg)) * 100
                result["mom_change"] = round(mom, 2)
            else:
                result["mom_change"] = 100.0 if curr_avg > 0 else (
                    -100.0 if curr_avg < 0 else 0.0
                )
        elif n >= 2:
            # 数据不足60天，用WoW近似MoM
            if result["wow_change"] is not None:
                result["mom_change"] = result["wow_change"]
            else:
                result["mom_change"] = result["total_change"]

        # --- 趋势方向：基于前后半部分均值比较 ---
        mid = n // 2
        first_half_avg = sum(values[:mid]) / max(len(values[:mid]), 1)
        second_half_avg = sum(values[mid:]) / max(len(values[mid:]), 1)

        if first_half_avg != 0:
            change_pct = (
                (second_half_avg - first_half_avg) / abs(first_half_avg)
            ) * 100
            if change_pct > self.TREND_THRESHOLD:
                result["trend_direction"] = "up"
            elif change_pct < -self.TREND_THRESHOLD:
                result["trend_direction"] = "down"
            else:
                result["trend_direction"] = "stable"
        else:
            # 前半部分均值为零的特殊情况
            if second_half_avg > first_half_avg:
                result["trend_direction"] = "up"
            elif second_half_avg < first_half_avg:
                result["trend_direction"] = "down"
            else:
                result["trend_direction"] = "stable"

        return result

    # ------------------------------------------------------------------
    # 异常检测
    # ------------------------------------------------------------------

    def detect_anomalies_zscore(self, data_points, threshold=2.0):
        """
        使用z-score方法检测异常值

        z-score = (value - mean) / stdev
        超过阈值(默认2σ)判定为异常，超过3σ判定为严重异常

        Args:
            data_points: [{date, value}, ...] 数据点列表
            threshold: z-score阈值

        Returns:
            异常列表 [{date, value, z_score, severity, direction}, ...]
        """
        values = [p["value"] for p in data_points]
        n = len(values)

        # 数据点少于3个无法进行有意义的异常检测
        if n < 3:
            return []

        mean_val = sum(values) / n

        # 样本标准差
        if n > 1:
            variance = sum((v - mean_val) ** 2 for v in values) / (n - 1)
            stdev_val = math.sqrt(variance)
        else:
            stdev_val = 0.0

        # 标准差为零（所有值相同），无异常
        if stdev_val == 0:
            return []

        anomalies = []
        for point in data_points:
            z_score = (point["value"] - mean_val) / stdev_val
            if abs(z_score) > threshold:
                severity = "severe" if abs(z_score) > 3 else "moderate"
                anomalies.append({
                    "date": point["date"],
                    "value": round(point["value"], 2),
                    "z_score": round(z_score, 2),
                    "severity": severity,
                    "direction": "spike" if z_score > 0 else "drop",
                })

        return anomalies

    # ------------------------------------------------------------------
    # 量价背离分析
    # ------------------------------------------------------------------

    def analyze_divergence(self):
        """
        量价背离分析：用户指标 vs 容量指标

        分析用户类指标与容量类指标之间的趋势背离情况：
        - user_up_capacity_down (水货用户): 用户上升但容量下降
        - user_down_capacity_up (大户依赖): 用户下降但容量上升
        - significant_divergence: 用户与容量变化幅度差异显著
        - normal: 用户与容量趋势一致
        """
        results = {}

        for user_metric, capacity_metric in self.DIVERGENCE_PAIRS:
            if (user_metric not in self.parsed_data
                    or capacity_metric not in self.parsed_data):
                continue

            user_trend = self.results.get(user_metric, {}).get("trend", {})
            capacity_trend = self.results.get(capacity_metric, {}).get("trend", {})

            user_wow = user_trend.get("wow_change")
            capacity_wow = capacity_trend.get("wow_change")

            user_direction = user_trend.get("trend_direction", "unknown")
            capacity_direction = capacity_trend.get("trend_direction", "unknown")

            # 判断背离类型
            divergence_type = "normal"
            divergence_desc = ""

            if user_wow is not None and capacity_wow is not None:
                # 基于WoW变化率判断
                if user_wow > 0 and capacity_wow < 0:
                    divergence_type = "user_up_capacity_down"
                    divergence_desc = (
                        "用户数上升但容量下降，可能存在水货用户"
                        "（活跃但未产生实际价值）"
                    )
                elif user_wow < 0 and capacity_wow > 0:
                    divergence_type = "user_down_capacity_up"
                    divergence_desc = (
                        "用户数下降但容量上升，可能存在大户依赖"
                        "（少数用户贡献大部分容量）"
                    )
                elif abs(user_wow - capacity_wow) > self.DIVERGENCE_THRESHOLD:
                    divergence_type = "significant_divergence"
                    divergence_desc = (
                        f"用户与容量变化幅度差异显著"
                        f"（用户WoW: {user_wow}%，容量WoW: {capacity_wow}%）"
                    )
                else:
                    divergence_type = "normal"
                    divergence_desc = "用户与容量趋势一致，无明显背离"
            else:
                # 数据不足，用趋势方向判断
                if user_direction == "up" and capacity_direction == "down":
                    divergence_type = "user_up_capacity_down"
                    divergence_desc = "用户数上升但容量下降，可能存在水货用户"
                elif user_direction == "down" and capacity_direction == "up":
                    divergence_type = "user_down_capacity_up"
                    divergence_desc = "用户数下降但容量上升，可能存在大户依赖"
                else:
                    divergence_type = "normal"
                    divergence_desc = "用户与容量趋势一致，无明显背离"

            pair_key = f"{user_metric}_vs_{capacity_metric}"
            results[pair_key] = {
                "user_metric": user_metric,
                "capacity_metric": capacity_metric,
                "user_metric_name": self.METRIC_NAMES.get(user_metric, user_metric),
                "capacity_metric_name": self.METRIC_NAMES.get(
                    capacity_metric, capacity_metric
                ),
                "user_wow": user_wow,
                "capacity_wow": capacity_wow,
                "user_direction": user_direction,
                "capacity_direction": capacity_direction,
                "divergence_type": divergence_type,
                "description": divergence_desc,
            }

        self.divergence_results = results
        return results

    # ------------------------------------------------------------------
    # 派生指标计算
    # ------------------------------------------------------------------

    def calculate_derived_metrics(self):
        """
        计算派生指标

        - 人均上传容量 = 上传容量 / DAU
        - 人均下载容量 = 下载容量 / DAU
        - 上传功能渗透率 = 上传用户数 / DAU
        - 下载功能渗透率 = 下载用户数 / DAU
        """
        results = {}

        dau_data = self.parsed_data.get("dau", [])
        upload_capacity_data = self.parsed_data.get("upload_capacity", [])
        download_capacity_data = self.parsed_data.get("download_capacity", [])
        upload_users_data = self.parsed_data.get("upload_users", [])
        download_users_data = self.parsed_data.get("download_users", [])

        # 通用计算函数：计算派生指标
        def _compute_derived(base_data, numerator_data, name, key):
            """计算两个指标逐日相除的派生指标"""
            if not base_data or not numerator_data:
                return None

            derived = []
            min_len = min(len(base_data), len(numerator_data))
            for i in range(min_len):
                base_val = base_data[i]["value"]
                num_val = numerator_data[i]["value"]
                if base_val != 0:
                    derived.append({
                        "date": base_data[i]["date"],
                        "value": round(num_val / base_val, 4),
                    })
                else:
                    # 除数为零，设为0
                    derived.append({
                        "date": base_data[i]["date"],
                        "value": 0.0,
                    })

            if not derived:
                return None

            values = [p["value"] for p in derived]
            stats = self.calculate_statistics(values)
            return {
                "name": name,
                "data": derived,
                "statistics": stats,
                "latest_value": values[-1] if values else None,
            }

        # 人均上传容量
        result = _compute_derived(
            dau_data, upload_capacity_data, "人均上传容量",
            "per_capita_upload_capacity"
        )
        if result:
            results["per_capita_upload_capacity"] = result

        # 人均下载容量
        result = _compute_derived(
            dau_data, download_capacity_data, "人均下载容量",
            "per_capita_download_capacity"
        )
        if result:
            results["per_capita_download_capacity"] = result

        # 上传功能渗透率
        result = _compute_derived(
            dau_data, upload_users_data, "上传功能渗透率",
            "upload_penetration_rate"
        )
        if result:
            results["upload_penetration_rate"] = result

        # 下载功能渗透率
        result = _compute_derived(
            dau_data, download_users_data, "下载功能渗透率",
            "download_penetration_rate"
        )
        if result:
            results["download_penetration_rate"] = result

        self.derived_metrics = results
        return results

    # ------------------------------------------------------------------
    # 综合分析
    # ------------------------------------------------------------------

    def comprehensive_analysis(self):
        """
        综合分析：整体健康度、关键发现、建议措施

        健康度评定规则:
        - 初始100分，根据异常、背离、趋势下降等情况扣分
        - >=80: healthy（健康）
        - >=50: warning（警告）
        - <50: critical（严重）
        """
        findings = []
        recommendations = []
        health_score = 100
        anomaly_count = 0
        divergence_count = 0
        critical_divergence_count = 0

        # --- 分析各指标趋势 ---
        for metric in self.analyze_metrics:
            if metric not in self.results:
                continue

            result = self.results[metric]
            trend = result.get("trend", {})
            anomalies = result.get("anomalies", [])

            metric_name = self.METRIC_NAMES.get(metric, metric)
            direction = trend.get("trend_direction", "unknown")
            total_change = trend.get("total_change")
            wow = trend.get("wow_change")

            # 关键发现：显著下降
            if direction == "down" and total_change is not None and total_change < -10:
                findings.append(
                    f"[下降] {metric_name}({metric})显著下降，"
                    f"总变化率 {total_change}%"
                )
                health_score -= 15

            # 关键发现：显著上升
            if direction == "up" and total_change is not None and total_change > 10:
                findings.append(
                    f"[上升] {metric_name}({metric})显著上升，"
                    f"总变化率 +{total_change}%"
                )

            # 周环比变化
            if wow is not None:
                if wow < -10:
                    findings.append(
                        f"[周环比] {metric_name}({metric})周环比下降 {wow}%"
                    )
                    health_score -= 5
                elif wow > 10:
                    findings.append(
                        f"[周环比] {metric_name}({metric})周环比上升 +{wow}%"
                    )

            # 异常检测结果
            if anomalies:
                anomaly_count += len(anomalies)
                severe_count = sum(
                    1 for a in anomalies if a["severity"] == "severe"
                )
                findings.append(
                    f"[异常] {metric_name}({metric})检测到 "
                    f"{len(anomalies)} 个异常点"
                    f"（其中 {severe_count} 个严重）"
                )
                health_score -= len(anomalies) * 3 + severe_count * 5

                for a in anomalies:
                    if a["severity"] == "severe":
                        direction_text = "激增" if a["direction"] == "spike" else "骤降"
                        recommendations.append(
                            f"调查 {metric_name} 在 {a['date']} 的异常"
                            f"（{direction_text}，z-score: {a['z_score']}）"
                        )

        # --- 背离分析 ---
        for pair_key, div_info in self.divergence_results.items():
            div_type = div_info["divergence_type"]
            if div_type == "normal":
                continue

            divergence_count += 1
            user_name = div_info["user_metric_name"]
            cap_name = div_info["capacity_metric_name"]

            if div_type == "user_up_capacity_down":
                findings.append(
                    f"[背离] {user_name}上升但{cap_name}下降，疑似水货用户"
                )
                health_score -= 15
                critical_divergence_count += 1
                recommendations.append(
                    f"排查 {user_name} 上升但 {cap_name} 下降的原因，"
                    "检查是否存在低质量活跃用户或刷量行为"
                )
            elif div_type == "user_down_capacity_up":
                findings.append(
                    f"[背离] {user_name}下降但{cap_name}上升，疑似大户依赖"
                )
                health_score -= 10
                critical_divergence_count += 1
                recommendations.append(
                    f"排查 {user_name} 下降但 {cap_name} 上升的原因，"
                    "关注头部用户集中度风险"
                )
            elif div_type == "significant_divergence":
                findings.append(
                    f"[背离] {user_name}与{cap_name}变化幅度差异显著"
                )
                health_score -= 8
                recommendations.append(
                    f"关注 {user_name} 与 {cap_name} 的变化差异，"
                    "进一步分析用户行为变化"
                )

        # --- 派生指标分析 ---
        for derived_key, derived_info in self.derived_metrics.items():
            latest = derived_info.get("latest_value")
            if latest is not None:
                findings.append(
                    f"[派生] {derived_info['name']}最新值: {latest}"
                )

                if "penetration" in derived_key:
                    if latest < 0.1:
                        findings.append(
                            f"[渗透率低] {derived_info['name']}偏低"
                            f"（{latest}），功能使用渗透不足"
                        )
                        health_score -= 5
                        recommendations.append(
                            f"提升{derived_info['name']}，"
                            "考虑增加功能引导或优化用户体验"
                        )

        # --- DAU趋势分析 ---
        if "dau" in self.results:
            dau_trend = self.results["dau"].get("trend", {})
            dau_direction = dau_trend.get("trend_direction")
            if dau_direction == "down":
                findings.append("[DAU] DAU呈下降趋势，需关注用户留存")
                health_score -= 10
                recommendations.append("加强用户留存策略，分析流失原因")
            elif dau_direction == "up":
                findings.append("[DAU] DAU呈上升趋势，用户规模增长良好")

        # --- 健康度评定 ---
        health_score = max(0, min(100, health_score))
        if health_score >= 80:
            health_status = "healthy"
        elif health_score >= 50:
            health_status = "warning"
        else:
            health_status = "critical"

        # --- 汇总建议 ---
        if not recommendations:
            if health_status == "healthy":
                recommendations.append("各项指标表现正常，继续保持当前运营策略")
            else:
                recommendations.append("建议进一步深入分析各指标变化原因")

        self.comprehensive = {
            "health_status": health_status,
            "health_score": health_score,
            "anomaly_count": anomaly_count,
            "divergence_count": divergence_count,
            "critical_divergence_count": critical_divergence_count,
            "key_findings": findings,
            "recommendations": recommendations,
            "analyzed_metrics": self.analyze_metrics,
            "data_period": self.period,
            "analysis_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

    # ------------------------------------------------------------------
    # 报告生成
    # ------------------------------------------------------------------

    def generate_markdown_report(self):
        """生成Markdown格式报告"""
        lines = []

        # --- 报告标题 ---
        report_title = "核心业务指标分析报告"
        if self.report_type == "daily":
            report_title = "核心业务指标日报"
        elif self.report_type == "weekly":
            report_title = "核心业务指标周报"
        elif self.report_type == "monthly":
            report_title = "核心业务指标月报"

        lines.append(f"# {report_title}")
        lines.append("")
        lines.append(
            f"**分析时间**: {self.comprehensive.get('analysis_time', '')}"
        )
        lines.append(f"**分析周期**: 最近 {self.period} 天")
        lines.append(
            f"**分析指标**: "
            f"{', '.join(self.comprehensive.get('analyzed_metrics', []))}"
        )
        detect_text = (
            f"开启 (阈值={self.threshold})"
            if self.detect_anomalies else "关闭"
        )
        lines.append(f"**异常检测**: {detect_text}")
        lines.append("")

        # --- 一、综合健康评估 ---
        health = self.comprehensive.get("health_status", "unknown")
        score = self.comprehensive.get("health_score", 0)
        health_emoji = {
            "healthy": "[健康]",
            "warning": "[警告]",
            "critical": "[严重]",
        }.get(health, "[未知]")

        lines.append("## 一、综合健康评估")
        lines.append("")
        lines.append("| 项目 | 结果 |")
        lines.append("|------|------|")
        lines.append(f"| 健康状态 | {health_emoji} {health} |")
        lines.append(f"| 健康评分 | {score}/100 |")
        lines.append(
            f"| 异常点数量 | {self.comprehensive.get('anomaly_count', 0)} |"
        )
        lines.append(
            f"| 背离数量 | {self.comprehensive.get('divergence_count', 0)} |"
        )
        lines.append(
            f"| 严重背离 | "
            f"{self.comprehensive.get('critical_divergence_count', 0)} |"
        )
        lines.append("")

        # --- 二、关键发现 ---
        lines.append("## 二、关键发现")
        lines.append("")
        findings = self.comprehensive.get("key_findings", [])
        if findings:
            for f in findings:
                lines.append(f"- {f}")
        else:
            lines.append("- 无特殊发现，各项指标正常")
        lines.append("")

        # --- 三、建议措施 ---
        lines.append("## 三、建议措施")
        lines.append("")
        recommendations = self.comprehensive.get("recommendations", [])
        if recommendations:
            for i, rec in enumerate(recommendations, 1):
                lines.append(f"{i}. {rec}")
        else:
            lines.append("1. 各项指标表现正常，继续保持当前运营策略")
        lines.append("")

        # --- 四、各指标详细分析 ---
        lines.append("## 四、各指标详细分析")
        lines.append("")

        for metric in self.analyze_metrics:
            if metric not in self.results:
                continue

            result = self.results[metric]
            metric_name = result["name"]
            stats = result["statistics"]
            trend = result["trend"]
            anomalies = result["anomalies"]

            lines.append(f"### {metric_name}（{metric}）")
            lines.append("")
            lines.append(f"**数据点数量**: {result['data_count']}")
            lines.append("")

            # 统计信息
            lines.append("#### 统计信息")
            lines.append("")
            lines.append("| 指标 | 值 |")
            lines.append("|------|------|")
            lines.append(f"| 最小值 | {stats.get('min', 'N/A')} |")
            lines.append(f"| 最大值 | {stats.get('max', 'N/A')} |")
            lines.append(f"| 均值 | {stats.get('mean', 'N/A')} |")
            lines.append(f"| 中位数 | {stats.get('median', 'N/A')} |")
            lines.append(f"| 标准差 | {stats.get('stdev', 'N/A')} |")
            lines.append("")

            # 趋势信息
            lines.append("#### 趋势分析")
            lines.append("")
            lines.append("| 指标 | 值 |")
            lines.append("|------|------|")
            direction = trend.get("trend_direction", "unknown")
            direction_text = {
                "up": "上升", "down": "下降",
                "stable": "平稳", "unknown": "未知",
            }.get(direction, direction)
            lines.append(f"| 趋势方向 | {direction_text} |")

            wow = trend.get("wow_change")
            lines.append(
                f"| 周环比(WoW) | "
                f"{f'{wow}%' if wow is not None else 'N/A'} |"
            )

            mom = trend.get("mom_change")
            lines.append(
                f"| 月环比(MoM) | "
                f"{f'{mom}%' if mom is not None else 'N/A'} |"
            )

            total = trend.get("total_change")
            lines.append(
                f"| 总变化率 | "
                f"{f'{total}%' if total is not None else 'N/A'} |"
            )
            lines.append("")

            # 异常检测
            if self.detect_anomalies and anomalies:
                lines.append("#### 异常检测")
                lines.append("")
                lines.append(
                    "| 日期 | 数值 | Z-Score | 严重度 | 类型 |"
                )
                lines.append("|------|------|---------|--------|------|")
                for a in anomalies:
                    lines.append(
                        f"| {a['date']} | {a['value']} | "
                        f"{a['z_score']} | {a['severity']} | "
                        f"{a['direction']} |"
                    )
                lines.append("")

            lines.append("---")
            lines.append("")

        # --- 五、量价背离分析 ---
        if self.divergence_results:
            lines.append("## 五、量价背离分析")
            lines.append("")
            lines.append(
                "| 用户指标 | 容量指标 | 用户WoW | 容量WoW | "
                "背离类型 | 说明 |"
            )
            lines.append(
                "|----------|----------|---------|---------|"
                "----------|------|"
            )
            for pair_key, div_info in self.divergence_results.items():
                user_name = div_info["user_metric_name"]
                cap_name = div_info["capacity_metric_name"]
                user_wow = div_info.get("user_wow")
                cap_wow = div_info.get("capacity_wow")
                div_type = div_info["divergence_type"]
                desc = div_info["description"]

                user_wow_str = (
                    f"{user_wow}%" if user_wow is not None else "N/A"
                )
                cap_wow_str = (
                    f"{cap_wow}%" if cap_wow is not None else "N/A"
                )

                lines.append(
                    f"| {user_name} | {cap_name} | "
                    f"{user_wow_str} | {cap_wow_str} | "
                    f"{div_type} | {desc} |"
                )
            lines.append("")

            # 背离类型说明
            lines.append("**背离类型说明**:")
            lines.append("")
            lines.append(
                "- `user_up_capacity_down` (水货用户): "
                "用户数上升但容量下降，用户活跃但未产生实际价值"
            )
            lines.append(
                "- `user_down_capacity_up` (大户依赖): "
                "用户数下降但容量上升，少数用户贡献大部分容量"
            )
            lines.append(
                "- `significant_divergence`: "
                "用户与容量变化幅度差异显著"
            )
            lines.append(
                "- `normal`: 用户与容量趋势一致，无明显背离"
            )
            lines.append("")

        # --- 六、派生指标 ---
        if self.derived_metrics:
            lines.append("## 六、派生指标")
            lines.append("")
            lines.append(
                "| 指标 | 最新值 | 最小值 | 最大值 | "
                "均值 | 中位数 |"
            )
            lines.append(
                "|------|--------|--------|--------|------|--------|"
            )
            for derived_key, derived_info in self.derived_metrics.items():
                stats = derived_info.get("statistics", {})
                latest = derived_info.get("latest_value")
                latest_str = (
                    round(latest, 4) if latest is not None else "N/A"
                )
                lines.append(
                    f"| {derived_info['name']} | "
                    f"{latest_str} | "
                    f"{stats.get('min', 'N/A')} | "
                    f"{stats.get('max', 'N/A')} | "
                    f"{stats.get('mean', 'N/A')} | "
                    f"{stats.get('median', 'N/A')} |"
                )
            lines.append("")

        # --- 页脚 ---
        lines.append("---")
        lines.append("*本报告由核心业务指标分析工具自动生成*")

        return "\n".join(lines)

    def generate_json_report(self):
        """生成JSON格式报告"""
        report = {
            "report_type": self.report_type or "default",
            "analysis_time": self.comprehensive.get("analysis_time", ""),
            "data_period": self.period,
            "health": {
                "status": self.comprehensive.get("health_status", "unknown"),
                "score": self.comprehensive.get("health_score", 0),
                "anomaly_count": self.comprehensive.get("anomaly_count", 0),
                "divergence_count": self.comprehensive.get(
                    "divergence_count", 0
                ),
                "critical_divergence_count": self.comprehensive.get(
                    "critical_divergence_count", 0
                ),
            },
            "key_findings": self.comprehensive.get("key_findings", []),
            "recommendations": self.comprehensive.get("recommendations", []),
            "metrics": {},
            "divergence": self.divergence_results,
            "derived_metrics": {},
        }

        # 各指标详情
        for metric in self.analyze_metrics:
            if metric not in self.results:
                continue
            result = self.results[metric]
            report["metrics"][metric] = {
                "name": result["name"],
                "data_count": result["data_count"],
                "statistics": result["statistics"],
                "trend": result["trend"],
                "anomalies": result["anomalies"],
            }

        # 派生指标
        for derived_key, derived_info in self.derived_metrics.items():
            report["derived_metrics"][derived_key] = {
                "name": derived_info["name"],
                "latest_value": derived_info.get("latest_value"),
                "statistics": derived_info.get("statistics", {}),
            }

        return json.dumps(report, ensure_ascii=False, indent=2)

    # ------------------------------------------------------------------
    # 主执行流程
    # ------------------------------------------------------------------

    def run(self):
        """执行完整分析流程"""
        # 1. 解析数据
        self.parse_data()

        # 2. 逐指标分析（统计、趋势、异常）
        for metric in self.analyze_metrics:
            data_points = self.parsed_data[metric]
            values = [p["value"] for p in data_points]

            stats = self.calculate_statistics(values)
            trend = self.calculate_trend(data_points)

            anomalies = []
            if self.detect_anomalies:
                anomalies = self.detect_anomalies_zscore(
                    data_points, self.threshold
                )

            self.results[metric] = {
                "name": self.METRIC_NAMES.get(metric, metric),
                "data_points": data_points,
                "data_count": len(data_points),
                "statistics": stats,
                "trend": trend,
                "anomalies": anomalies,
            }

        # 3. 量价背离分析
        if self.analysis == "divergence" or self.analysis is None:
            self.analyze_divergence()

        # 4. 派生指标计算
        self.calculate_derived_metrics()

        # 5. 综合分析
        self.comprehensive_analysis()


# ======================================================================
# 命令行入口
# ======================================================================

def main():
    """主函数：解析命令行参数并执行分析"""
    parser = argparse.ArgumentParser(
        description="核心业务指标分析工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 基本分析（Markdown报告输出到stdout）
  python analyze_core_metrics.py --input data.json

  # 输出报告到文件
  python analyze_core_metrics.py --input data.json --output report.md

  # 带异常检测的分析
  python analyze_core_metrics.py --input data.json --detect-anomalies --threshold 2.5

  # 量价背离分析（JSON输出）
  python analyze_core_metrics.py --input data.json --analysis divergence --json

  # 指定指标和周期
  python analyze_core_metrics.py --input data.json --metrics dau,upload_users,upload_capacity --period 60

  # 日报
  python analyze_core_metrics.py --input data.json --report-type daily --output daily_report.md
        """,
    )

    parser.add_argument(
        "--input",
        required=True,
        help="输入JSON文件路径",
    )
    parser.add_argument(
        "--metrics",
        type=str,
        default=None,
        help="要分析的指标，逗号分隔（如: dau,upload_users,upload_capacity）",
    )
    parser.add_argument(
        "--period",
        type=int,
        default=30,
        help="分析周期（最近多少天的数据），默认30",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="输出文件路径（不指定则输出到stdout）",
    )
    parser.add_argument(
        "--detect-anomalies",
        action="store_true",
        help="是否检测异常（z-score方法）",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=2.0,
        help="异常检测z-score阈值，默认2.0（2σ）",
    )
    parser.add_argument(
        "--analysis",
        type=str,
        default=None,
        help="分析类型（如: divergence 量价背离分析）",
    )
    parser.add_argument(
        "--report-type",
        type=str,
        default=None,
        choices=["daily", "weekly", "monthly"],
        help="报告类型：daily日报/weekly周报/monthly月报",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="以JSON格式输出（默认Markdown）",
    )

    args = parser.parse_args()

    # --- 读取输入文件 ---
    try:
        with open(args.input, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"错误: 输入文件不存在: {args.input}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"错误: JSON解析失败: {e}", file=sys.stderr)
        sys.exit(1)
    except PermissionError:
        print(f"错误: 无权限读取文件: {args.input}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"错误: 读取文件失败: {e}", file=sys.stderr)
        sys.exit(1)

    # --- 解析指标列表 ---
    metrics = None
    if args.metrics:
        metrics = [m.strip() for m in args.metrics.split(",") if m.strip()]

    # --- 参数验证 ---
    if args.period <= 0:
        print("错误: --period 必须大于0", file=sys.stderr)
        sys.exit(1)

    if args.threshold <= 0:
        print("错误: --threshold 必须大于0", file=sys.stderr)
        sys.exit(1)

    # --- 创建分析器并执行 ---
    try:
        analyzer = CoreMetricsAnalyzer(
            data=data,
            metrics=metrics,
            period=args.period,
            detect_anomalies=args.detect_anomalies,
            threshold=args.threshold,
            analysis=args.analysis,
            report_type=args.report_type,
        )
        analyzer.run()
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"错误: 分析过程中出错: {e}", file=sys.stderr)
        sys.exit(1)

    # --- 生成报告 ---
    if args.json:
        report = analyzer.generate_json_report()
    else:
        report = analyzer.generate_markdown_report()

    # --- 输出 ---
    if args.output:
        try:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(report)
            print(f"报告已生成: {args.output}", file=sys.stderr)
        except PermissionError:
            print(f"错误: 无权限写入文件: {args.output}", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print(f"错误: 写入输出文件失败: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        print(report)


if __name__ == "__main__":
    main()
