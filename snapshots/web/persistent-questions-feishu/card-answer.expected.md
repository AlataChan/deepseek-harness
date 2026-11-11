## notification state
"sent"

## card plain question and routing copy
[{"tag":"div","text":{"content":"Which deployment region?","tag":"plain_text"}},{"elements":[{"content":"有效期至 {{iso}}。仅桌面应用在线时可作答。","tag":"plain_text"}],"tag":"note"},{"elements":[{"content":"按钮用于回答此问题；直接发文字会进入独立的 IM 会话。也可回到桌面中的原对话回答。","tag":"plain_text"}],"tag":"note"},{"actions":[{"tag":"button","text":{"content":"/production","tag":"plain_text"},"type":"default","value":{"choiceOrdinal":1,"decisionId":"{{decisionId:1}}","kind":"session-question","publicationId":"{{publicationId}}","revision":0}},{"tag":"button","text":{"content":"Keep staging","tag":"plain_text"},"type":"default","value":{"choiceOrdinal":2,"decisionId":"{{decisionId:1}}","kind":"session-question","publicationId":"{{publicationId}}","revision":0}}],"tag":"action"}]

## answer admission
{"card":{"config":{"wide_screen_mode":true},"elements":[{"tag":"div","text":{"content":"Which deployment region?","tag":"plain_text"}},{"elements":[{"content":"有效期至 {{iso}}。仅桌面应用在线时可作答。","tag":"plain_text"}],"tag":"note"},{"elements":[{"content":"按钮用于回答此问题；直接发文字会进入独立的 IM 会话。也可回到桌面中的原对话回答。","tag":"plain_text"}],"tag":"note"},{"tag":"div","text":{"content":"此问题已不可作答，请回到桌面查看。","tag":"plain_text"}}],"header":{"title":{"content":"等待您的决定","tag":"plain_text"}}},"success":true,"toast":"回答已受理；执行结果请查看原对话。"}

## duplicate answer
{"card":{"config":{"wide_screen_mode":true},"elements":[{"tag":"div","text":{"content":"Which deployment region?","tag":"plain_text"}},{"elements":[{"content":"有效期至 {{iso}}。仅桌面应用在线时可作答。","tag":"plain_text"}],"tag":"note"},{"elements":[{"content":"按钮用于回答此问题；直接发文字会进入独立的 IM 会话。也可回到桌面中的原对话回答。","tag":"plain_text"}],"tag":"note"},{"tag":"div","text":{"content":"此问题已不可作答，请回到桌面查看。","tag":"plain_text"}}],"header":{"title":{"content":"等待您的决定","tag":"plain_text"}}},"success":true,"toast":"回答已受理；执行结果请查看原对话。"}

## entered human texts
["Ask me which region to use.","Answer to question {{decisionId:1}}: option 1"]

## entered human sources
[{"kind":"user","rpcId":"9db3f74f-3dd4-4407-9f5d-e18d4ab93d08"},{"kind":"user","rpcId":"{{decisionId:1}}"}]

## current question
{"answerIndex":"admitted","choices":["/production","Keep staging"],"closedAtUtc":"{{iso}}","createdAtUtc":"{{iso}}","decisionId":"{{decisionId:1}}","expiresAtUtc":"{{iso}}","hasAnswer":true,"lifecycle":"answered","notificationStatus":"sent","question":"Which deployment region?","requestId":"{{decisionId:1}}","revision":2,"sessionId":"{{session:1}}","suspended":false}
