## goal at setup pause (direct service, immediate)
{"activation":"disarmed","phase":"paused","revision":2}

## view goalDisarmed while paused (gateway get)
undefined

## answer submit outcome (gateway submit)
"accepted"

## update_goal tool results (raw)
[{"body":"Error: the model cannot resume a paused goal; the user must resume it","isError":true}]

## goal after rejected model resume (direct service, immediate)
{"activation":"disarmed","phase":"paused"}

## settled gateway Remote get after answer
{"answerIndex":"admitted","choices":[],"closedAtUtc":"{{iso}}","createdAtUtc":"{{iso}}","decisionId":"{{decisionId:1}}","expiresAtUtc":"{{iso}}","hasAnswer":true,"lifecycle":"answered","question":"Continue the migration rounds?","requestId":"{{decisionId:1}}","revision":2,"sessionId":"{{session:1}}","suspended":false}

## scripted model calls consumed
4
