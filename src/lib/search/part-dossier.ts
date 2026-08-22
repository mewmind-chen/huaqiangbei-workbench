import { orderedSpecs, partPositioning, translateApps } from "@/lib/search/analyze";
import type { LcscAlt } from "@/lib/search/md-parse";
import type { IntelBrief, PartIdentity } from "@/lib/search/result-types";

export type Knowledge = {
  family: string;
  what: string;
  use: string;
  customers: string;
  notes: string[];
  related: string[];
};

const CATALOG: { test: RegExp; knowledge: Knowledge }[] = [
  {
    test: /^STM32F103C8/i,
    knowledge: {
      family: "STM32F1 主流增强型（medium-density）",
      what: "ST 的入门工控 MCU。Cortex-M3、72MHz，C8 这一档是 64KB Flash / 20KB SRAM，常见 LQFP-48（7×7）。货场说「48 脚 F103」多半指这颗。学习板 Blue Pill 也是它。",
      use: "电机 PWM、USB 从机、CAN 总线、小型 PLC 外围、手持终端、对讲和打印机控制板。",
      customers: "电控厂、工控方案商、医疗手持、楼宇对讲、办公外设。",
      notes: [
        "客户只说 F103，要问清 C8（64K）还是 CB（128K），脚位接近但程序空间不同。",
        "T6 是 -40~85°C，T7 是 -40~105°C。",
        "TR 是编带；托盘/管装一般写 T6。",
        "国产脚位兼容常见极海 APM32F103C8T6、中科芯 CKS32F103C8T6、兆易 GD32F103C8T6，报价差一截，要确认启动方式和外设。",
      ],
      related: ["STM32F103CBT6", "STM32F103C8T6TR", "APM32F103C8T6", "CKS32F103C8T6"],
    },
  },
  {
    test: /^STM32F103CB/i,
    knowledge: {
      family: "STM32F1 主流增强型",
      what: "F103 的 128KB Flash 档，RAM 仍约 20KB，脚位和 C8 接近。程序大、协议栈多的客户会点名 CB，不要用 C8 顶。",
      use: "比 C8 更吃 Flash 的工控、USB、CAN 方案。",
      customers: "工控方案、电控、需要 128K 的改板客户。",
      notes: [
        "和 C8T6 不是同一颗料，Flash 差一倍。",
        "国产兼容同样看 APM32/CKS32/GD32 的 CBT6。",
      ],
      related: ["STM32F103C8T6", "STM32F103CBT6TR"],
    },
  },
  {
    test: /^STM32F103/i,
    knowledge: {
      family: "STM32F1 主流型",
      what: "ST 最常见的 F1 家族，Cortex-M3、最高 72MHz。后缀 C6/C8/CB 和封装脚数决定 Flash 和尺寸，报价前对一下完整型号。",
      use: "工控、电机、USB、CAN、常规控制器。",
      customers: "电控、工控方案、自动化。",
      notes: ["先对完整型号和封装，不要只听「F103」。"],
      related: [],
    },
  },
  {
    test: /^STM32F4/i,
    knowledge: {
      family: "STM32F4 高性能",
      what: "F4 是 Cortex-M4F，带 FPU，主频和外设比 F1 高一档。价钱和货期都和 F103 不是同一路客户。",
      use: "需要 DSP/浮点、更高主频的工控、逆变、显示和通讯。",
      customers: "电力电子、高端工控、仪器。",
      notes: ["不要用 F1 的价去套 F4。", "同系列要问清 Flash 档和封装。"],
      related: [],
    },
  },
  {
    test: /^STM32F0/i,
    knowledge: {
      family: "STM32F0 入门型",
      what: "Cortex-M0，比 F1 更便宜的入门 MCU，外设和主频都低一档。",
      use: "简单控制、消费电子、成本敏感的板。",
      customers: "消费电子、小家电、入门工控。",
      notes: ["和 F103 不是替代关系，内核和外设都不同。"],
      related: [],
    },
  },
  {
    test: /^STM32G0/i,
    knowledge: {
      family: "STM32G0",
      what: "F0 的后续入门线，Cortex-M0+，新设计比 F0 多见。",
      use: "新项目的入门 MCU、家电、简单工控。",
      customers: "消费电子、家电方案。",
      notes: ["老客户如果在用 F0/F1，换 G0 要重新评估脚位和生态。"],
      related: [],
    },
  },
  {
    test: /^ESP32/i,
    knowledge: {
      family: "乐鑫 Wi-Fi / 蓝牙模组或芯片",
      what: "Wi-Fi + 蓝牙的无线 MCU/模组。WROOM、WROVER、C3、S3 不是同一颗，天线和 Flash 封装差很多。",
      use: "物联网、网关、无线控制、智能家居。",
      customers: "物联网方案、家电、网关厂。",
      notes: [
        "模组要问清 Flash 容量、天线（PCB/IPEX）和封装。",
        "WROOM-32E 和 32D、32 原片不是一回事。",
      ],
      related: [],
    },
  },
  {
    test: /^W25Q/i,
    knowledge: {
      family: "华邦 SPI NOR Flash",
      what: "常见串行 Flash。容量看数字：64=64Mbit，128=128Mbit。JV、JVSIQ 等后缀是电压和规格，不能只听 W25Q64。",
      use: "MCU 外挂程序/参数存储、网卡、显示。",
      customers: "方案商、消费电子、工控。",
      notes: ["对容量、电压（2.5/3.3V）和封装（SOP8 150mil vs 208mil）。"],
      related: [],
    },
  },
  {
    test: /^AT24C|^24C/i,
    knowledge: {
      family: "I2C EEPROM",
      what: "小容量参数存储器。02 是 2Kbit，256 是 256Kbit，差一百倍。",
      use: "保存配置、校准、小参数。",
      customers: "几乎所有带 MCU 的板子都可能用到。",
      notes: ["问清容量、电压、封装（SOP8 最常见）。"],
      related: [],
    },
  },
];

export function extraKnowledge(mpn: string): Knowledge | null {
  const key = mpn.trim().toUpperCase();
  const hit = CATALOG.find((row) => row.test.test(key));
  return hit ? hit.knowledge : null;
}

export function buildDossier(identity: PartIdentity, alts: LcscAlt[], intel?: IntelBrief | null) {
  const extra = extraKnowledge(identity.mpn);
  const specs = orderedSpecs(identity.specs);
  const apps = translateApps(identity.applications || []);
  const replacements = alts.filter((a) => a.mpn.toUpperCase() !== identity.mpn.toUpperCase()).slice(0, 8);
  const who = [...new Set(apps.map((a) => a.who).filter(Boolean))];
  const catalogNotes = extra?.notes || [];
  const intelNotes = (intel?.notes || []).filter(
    (n) => !catalogNotes.some((e) => e.slice(0, 24) === n.slice(0, 24)),
  );
  const liveNotes = [...catalogNotes, ...intelNotes].slice(0, 8);
  return {
    extra,
    liveNotes,
    specs,
    apps,
    replacements,
    who,
    positioning: partPositioning(identity),
    headline:
      extra?.what.split("。")[0] ||
      identity.summary ||
      intel?.summary ||
      identity.category ||
      identity.mpn,
  };
}
