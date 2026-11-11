## checkpoint view answerIndex (gateway get)
"submitting"

## pending queue at checkpoint (direct inbox read)
[{"text":"Answer to question {{decisionId:1}}: option 1"}]

## settled gateway Remote get after restore
{"answerIndex":"admitted","choices":["Bump","Keep 100"],"closedAtUtc":"{{iso}}","createdAtUtc":"{{iso}}","decisionId":"{{decisionId:1}}","expiresAtUtc":"{{iso}}","hasAnswer":true,"lifecycle":"superseded","question":"Bump the rate limit to 200 rps?","requestId":"{{decisionId:1}}","revision":5,"sessionId":"{{session:1}}","suspended":false}

## entered user texts (raw transcript)
["Ask me about the rate limit.","Continue with the saved queued answer.","Answer to question {{decisionId:1}}: option 1"]

## entered user sources (raw transcript)
[{"kind":"user","rpcId":"9db3f74f-3dd4-4407-9f5d-e18d4ab93d08"},{"kind":"user","rpcId":"41fac33d-c939-466f-92e4-594d22ed95b9"},{"kind":"user","rpcId":"{{decisionId:1}}"}]

## model calls on restart (only the answer turn)
1
