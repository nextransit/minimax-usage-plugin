> ## Documentation Index
> Fetch the complete documentation index at: https://platform.minimaxi.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 常见问题

> 参考文档，了解关于 Token Plan 订阅套餐的相关问题

<div id="contact-us" />

## 问题反馈与使用交流有哪些渠道？

问题反馈与使用交流，请参考如下[渠道](https://platform.minimaxi.com/docs/faq/contact-us)。

***

<div id="token-plan-key" />

<div id="available-plans" />

## 现在有哪些 Token Plan 套餐可以选择？

当前公开订阅档位为 **Plus**、**Max** 和 **Ultra**。

| 套餐    | 价格       | 典型 Agent 用量 |
| :---- | :------- | :---------- |
| Plus  | ¥49 / 月  | 3-4 个 Agent |
| Max   | ¥119 / 月 | 4-5 个 Agent |
| Ultra | ¥469 / 月 | 6-7 个 Agent |

Ultra 面向更重度的 Agent 工作流用户。

更多价格、额度窗口和积分包信息，请参考 [Token Plan 定价](/guides/pricing-token-plan)。

***

<div id="switch-models" />

## Token Plan 支持哪些资源，以及如何切换资源？

Token Plan 支持开放平台上的所有模型。用户无需按模型分别计算额度；控制台会通过统一的用量进度条展示套餐内额度和消耗情况。

对于已有按量计费价格的 API 端点，用量会按对应按量计费价格扣减套餐内 Token Plan 额度。不同模型、不同模态的实际消耗会不同。

<Tip>
  在 AI Agent 中调用支持的资源，请参考 [MiniMax CLI 指南](https://platform.minimaxi.com/docs/token-plan/minimax-cli)。
</Tip>

如需切换模型，请使用对应 API 或工具接入页面中说明的模型 ID。

***

<div id="shared-credits-pool" />

## 文本、图片、语音等额度是分开的吗？

不是。Token Plan 覆盖范围内的模型用量共享同一套套餐内 Token Plan 额度。您可以根据实际需求，将额度灵活用于不同模型和能力。

不同资源的用量消耗不同，实际可用资源和用量消耗以控制台展示为准。

***

<div id="token-plan-key" />

## 订阅 Key 是什么？

订阅 Key 是用于 Token Plan 订阅套餐和已购积分的 Key。

每位用户在所属的每个团队中都会拥有一把专属的订阅 Key。这把 Key 可以在团队尚未购买 Token Plan 席位或积分时就存在。在这种状态下，它暂时没有可用的付费资源。当用户被分配 Token Plan 席位，或获得积分使用权限后，同一把 Key 即可使用这些资源。

订阅 Key 与普通按量计费 API Key 相互独立，不能混用。

***

<div id="credits" />

<div id="credits-value" />

## 已购积分怎么折算？

已购积分是可单独购买的补充余额，用于覆盖 Token Plan 资源范围内的合规超额用量。

* **1,000 积分 = ¥7**，与开放平台 API 按量付费目录价等值。
* 使用已购积分调用已有按量计费价格的资源时，会按该资源的目录价折算为积分扣减。
* 文本、图像、语音、音乐等资源可由已购积分覆盖；视频等资源以对应套餐权益和控制台展示为准。
* 如果同一用量同时可由套餐内额度和已购积分覆盖，系统会优先扣除套餐内额度，超出部分再扣除已购积分。

***

<div id="credits" />

## 没有 Token Plan 订阅也可以使用积分吗？

可以。积分可以在没有 Token Plan 订阅席位的情况下单独购买和使用。

已购积分仍然通过订阅 Key 使用，资源覆盖范围与 Token Plan 相同。如果您没有 Token Plan 席位，但拥有积分权限，该覆盖范围内的用量会扣除已购积分。

如果您同时拥有套餐内 Token Plan 额度和已购积分，系统会优先扣除套餐内额度，超出部分再由已购积分自动补充支付。

如需使用 Token Plan 覆盖范围之外的资源，请使用按量计费 API Key。

详情请参考 [Token Plan 定价](/guides/pricing-token-plan)。

***

<div id="default-team" />

<div id="check-usage" />

## 如何查看 Token Plan 用量？

您可以通过以下两种方式查看 Token Plan 用量：

方式一：访问套餐用量页面

访问 [订阅付费 > 套餐用量](https://platform.minimaxi.com/console/usage) 页面查看您的套餐、额度、积分和用量情况。

方式二：使用 API 接口查询

```bash theme={null}
curl --location 'https://www.minimaxi.com/v1/token_plan/remains' \
--header 'Authorization: Bearer <API Key>' \
--header 'Content-Type: application/json'
```

通常情况下：

* **低消耗**：日常聊天、翻译、简单写作。
* **中等消耗**：代码生成、多轮对话。
* **较高消耗**：长上下文推理、多模态任务、复杂 Agent 工作流。

***

<div id="reset-calculation" />

## 用量是如何重置的？

Token Plan 用量通过控制台用量进度条展示，并受额度窗口控制：

* **套餐内 Token Plan 额度**：受 5 小时固定窗口和周窗口控制。
* **订阅周期**：未使用完的套餐内 Token Plan 额度不会结转到下一个计费周期。
* **已购积分**：按自身有效期使用，不会因为套餐窗口刷新而重置有效期。

老用户迁移和周发放规则请参考 [Token Plan 迁移方案](/token-plan/migration)。

***

<div id="switch-models" />

<div id="quota-limit" />

## 达到限额上限怎么办？

达到 5 小时固定窗口或周窗口上限时，您可以选择：

* **使用已购积分**：如果已购积分可用，Token Plan 覆盖范围内的用量可由已购积分自动补充支付。
* **升级订阅套餐**：前往 [Token Plan](https://platform.minimaxi.com/subscribe/token-plan) 页面升级到更高级别的套餐，升级后立即生效。
* **切换到按量付费**：如果您希望使用普通开放平台按量计费资源，可以将工具中的订阅 Key 更换为普通开放平台 API Key，按实际 token 使用量消耗账户余额。
* **等待额度窗口重置**：套餐内额度受 5 小时固定窗口和周窗口控制；未使用完的套餐内额度不会结转到下一个计费周期。

***

<div id="api-key-interchangeable" />

## Token Plan 的 API Key 和开放平台普通的 API Key 可以混用吗？

不可以。

* **订阅 Key**：用于套餐内 Token Plan 额度和已购积分。已有按量计费价格的 API 端点会按对应按量计费价格扣减套餐内 Token Plan 额度。已购积分的资源覆盖范围与 Token Plan 相同，可承接订阅额度之外的合规超额用量。
* **普通开放平台 API Key**：用于按量付费访问标准开放平台 API 接口，按实际 token 消耗量计费，消耗您的账户余额。

***

<div id="api-vlm" />

## API-vlm 在 Token Plan 中如何计费？

API-vlm 支持图像理解，输出为文本。

使用 Token Plan 调用时，API-vlm 会按其按量计费价格扣减套餐内 Token Plan 额度。如果套餐内额度耗尽且已购积分可用，超出部分可由已购积分自动补充支付。

***

<div id="multiple-tools" />

## 是否可以同时在多个工具中使用我的订阅套餐？

可以，您可以在所有支持的工具中使用同一订阅套餐，但额度是共享的，所有工具的使用会消耗同一套餐额度。

***

<div id="cancel-renewal" />

## 如何取消自动续订？

您可以在订阅管理页面取消自动续订。取消前请注意：

* 当前已发放的套餐内 Token Plan 额度在有效期内仍可正常使用。
* 已获得的补偿积分在有效期内仍可使用。
* 老用户专属保留档取消后的影响，请参考 [Token Plan 迁移方案](/token-plan/migration)。

***

<div id="invoice" />

## 合并支付的订单如何开票？

开票规则如下：

* **支付宝直接付款**：可以开票
* **余额支付**：可以开票
* **余额 + 支付宝组合支付**：可以开票
* **代金券抵扣部分**：不可开票，仅实际支付的金额可以开具发票

如订单中使用了代金券，开票金额为扣除代金券后的实际支付金额。

***

<div id="tps-calculation" />

## 语言模型的 TPS（Tokens Per Second）是如何计算的？

TPS 表示模型每秒生成的 token 数量，用于衡量模型的推理输出速度。计算公式为：

$$
\text{TPS} = \frac{\text{输出 token 数量}}{\text{最后一个 token 的生成时间} - \text{第一个 token 的生成时间}}
$$

即从模型输出第一个 token 开始计时，到最后一个 token 输出完成为止，期间生成的 token 总数除以这段时间（秒）。

<Note>
  TPS 在实际使用中可能存在波动，各页面上标注的 TPS 为参考值。
</Note>

***

<div id="token-plan-limits" />

## Token Plan 有哪些使用限制？是否适合生产环境？

Token Plan 面向个人开发者的交互式使用场景，更高的套餐等级提供更高的额度上限。生产环境建议使用按量付费。

主要限制包括：

* **速率限制（RPM / TPM）**：超出后会限流，通常约 1 分钟恢复，高峰期可能动态收紧。
* **套餐内 Token Plan 额度**：受 5 小时固定窗口和周窗口控制。

***

<div id="highspeed-plan" />

<div id="token-plan-limit-rules" />

## 平台流量规则是什么？

为保障对所有用户的服务稳定性和可用性，MiniMax 平台可能在高峰时段实施动态限流策略。

我们观测到，部分请求来自超高并发自动化批量任务或多用户共享模式。为了避免少数异常流量挤占公共算力池，并保障大多数用户的稳定体验，平台会基于账户使用维度进行速率调控。

平台限流规则与行业实践保持一致，MiniMax 将在高峰时段进行动态限流：

* **流量高峰时段**：根据集群负载动态调整，通常出现在工作日 15:00-17:30。
  * Plus：约支持 3-4 个 Agent。
  * Max：约支持 4-5 个 Agent。
  * Ultra：约支持 6-7 个 Agent。
* **套餐额度**：套餐内 Token Plan 额度受 5 小时固定窗口和周窗口控制，未使用完的套餐内额度不会结转到下一个计费周期。

同时，我们正在持续推进算力扩容与系统优化，努力提供更稳定、可靠的服务。

***

<div id="upgrade-plan" />

<div id="check-usage" />

<div id="reset-calculation" />

<div id="quota-limit" />

* 使用已购积分 \
  如果已购积分可用，Token Plan 资源覆盖范围内的用量可由已购积分自动补充支付。
* 升级订阅套餐 \
  您可以前往 [Token Plan](https://platform.minimaxi.com/subscribe/token-plan) 页面升级到更高级别的套餐，获取更多的请求用量。Token Plan 支持随时升级，升级后立即生效。
* 切换到按量付费（Pay as you go） \
  如果您希望不受速率限制，您可以将编程工具中的 API Key 更换为您的从账户管理系统，MiniMax 开放平台普通的 API Key。这样，工具将切换到按实际 token 使用量计费的模式，消耗您的开放平台账户余额。
* 等待重置 \
  文本模型的限额是基于一个动态的 5 小时窗口。您可以暂停使用，等待窗口滚动，额度将会自动恢复。

<div id="api-key-interchangeable" />

<div id="api-vlm" />

<div id="multiple-tools" />

<div id="refund" />

<div id="invoice" />

<div id="tps-calculation" />

<div id="token-plan-limits" />

<div id="token-plan-limit-rules" />

如您在订阅服务中遇到任何问题，可扫描底部官方客服二维码，获得支持。
