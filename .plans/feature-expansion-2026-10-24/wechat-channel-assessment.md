# WeChat channel assessment

Decision: do not add a WeChat transport in this implementation. DingTalk Stream is the second concrete channel; no channel-neutral public service is extracted before integration evidence establishes independently changing consumers.

Tencent documents an enterprise WeCom intelligent-bot API with outbound WebSocket and URL-callback connection modes. Its documented setup requires an enterprise administrator to create an API-mode bot and obtain Bot ID and Secret. The document also states that one bot holds one effective long connection. These are enterprise-bot capabilities, not evidence of a supported interface for automating arbitrary personal WeChat conversations. Source: [Tencent enterprise-bot integration guide](https://cloud.tencent.com/document/product/1759/121473), last updated 2026-10-19; reviewed 2026-10-24.

No designated WeCom enterprise, test bot, authorized operator or credential budget is available to this task. The direct WeCom receive-message and WeChat customer-service documentation could not be retrieved by the review browser, so their detailed protocol, qualification requirements and limits remain unverified. No third-party mirror is treated as protocol authority.

A later WeCom intake must first verify official protocol documentation and a designated test bot, then prove authenticated identity, durable receive acknowledgement, repeated-message deduplication, bounded reconnection, uncertain outbound acceptance and single-connection ownership. Existing ingress storage may be evaluated after that concrete consumer exists; Feishu and DingTalk identity fields must not be reused by assumption. Personal-account automation, scraping and private protocols are outside this assessment.

Result: documentation assessment complete; WeChat transport and live qualification not run. This decision does not qualify either implemented channel for production.
