## goal at create (direct service, immediate)
{"activation":"armed","phase":"active","revision":1}

## goal before question (direct service, immediate)
{"activation":"armed","phase":"active"}

## view goalDisarmed after question (gateway get)
true

## goal after question (direct service, immediate)
{"activation":"disarmed","phase":"active"}

## answer submit outcome (gateway submit)
"accepted"

## update_goal tool results (raw)
[{"body":"{\"goal\":{\"id\":\"{{goalId:1}}\",\"revision\":2,\"objective\":\"Finish the migration rounds\",\"phase\":\"active\",\"roundsStarted\":0,\"maxGoalRounds\":256},\"activation\":\"armed\"}","isError":false},{"body":"{\"goal\":{\"id\":\"{{goalId:1}}\",\"revision\":3,\"objective\":\"Finish the migration rounds\",\"phase\":\"complete\",\"roundsStarted\":0,\"maxGoalRounds\":256},\"activation\":\"disarmed\"}","isError":false}]

## goal after answer-turn resume+complete (direct service, immediate)
{"activation":"disarmed","phase":"complete"}

## settled gateway Remote get after answer
{"answerIndex":"admitted","choices":[],"closedAtUtc":"{{iso}}","createdAtUtc":"{{iso}}","decisionId":"{{decisionId:1}}","expiresAtUtc":"{{iso}}","hasAnswer":true,"lifecycle":"answered","question":"Continue the migration rounds?","requestId":"{{decisionId:1}}","revision":2,"sessionId":"{{session:1}}","suspended":false}

## scripted model calls consumed
5
