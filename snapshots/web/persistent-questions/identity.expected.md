## question tool call (raw)
[{"arguments":"{\"question\":\"Deploy the staging build to production?\",\"choices\":[\"/deploy-prod\",\"Hold staging\"]}","callId":"call-ask"}]

## question tool result (raw)
[{"body":"Question saved and delivered to the user. Decision ID: {{decisionId:1}} (revision 0). It expires at {{iso}}. The turn has ended; wait for the user's answer. The answer arrives as a queued user message starting with \"Answer to question {{decisionId:1}}:\". If the user picks a choice, the message names the option; otherwise it carries their free text. Choices as presented to the user:\n1. /deploy-prod\n2. Hold staging The question and its answer stay readable after context compaction through read_persistent_question with decisionId \"{{decisionId:1}}\".","callId":"call-ask","isError":false,"meta":{"decisionId":"{{decisionId:1}}","revision":0}}]

## gateway Remote catalog after question
{"answerIndex":"none","choices":["/deploy-prod","Hold staging"],"createdAtUtc":"{{iso}}","decisionId":"{{decisionId:1}}","expiresAtUtc":"{{iso}}","hasAnswer":false,"lifecycle":"open","question":"Deploy the staging build to production?","requestId":"{{decisionId:1}}","revision":0,"sessionId":"{{session:1}}","suspended":false}

## read tool call (raw)
[{"arguments":"{\"decisionId\":\"{{decisionId:1}}\"}","callId":"call-read"}]

## read tool result (raw)
[{"body":"{\"decisionId\":\"{{decisionId:1}}\",\"sessionId\":\"{{session:1}}\",\"question\":\"Deploy the staging build to production?\",\"choices\":[\"/deploy-prod\",\"Hold staging\"],\"createdAtUtc\":\"{{iso}}\",\"expiresAtUtc\":\"{{iso}}\",\"revision\":2,\"lifecycle\":\"answered\",\"answerIndex\":\"admitted\",\"hasAnswer\":true,\"closedAtUtc\":\"{{iso}}\",\"suspended\":false}","callId":"call-read","isError":false,"meta":{"decisionId":"{{decisionId:1}}","revision":2}}]

## gateway Remote status
{"available":true}

## gateway Remote duplicate retry outcome
"admitted"

## gateway Remote conflicting retry outcome
"DECISION_CONFLICT"

## gateway Remote get after retries
{"answerIndex":"admitted","choices":["/deploy-prod","Hold staging"],"closedAtUtc":"{{iso}}","createdAtUtc":"{{iso}}","decisionId":"{{decisionId:1}}","expiresAtUtc":"{{iso}}","hasAnswer":true,"lifecycle":"answered","question":"Deploy the staging build to production?","requestId":"{{decisionId:1}}","revision":2,"sessionId":"{{session:1}}","suspended":false}

## scripted model calls consumed
3

## model calls unchanged across retries
true

## entered user texts (raw transcript)
["Please ask me about the deployment.","Answer to question {{decisionId:1}}: option 2"]

## entered user sources (raw transcript)
[{"kind":"user","rpcId":"9db3f74f-3dd4-4407-9f5d-e18d4ab93d08"},{"kind":"user","rpcId":"{{decisionId:1}}"}]
