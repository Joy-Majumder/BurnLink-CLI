@ECHO off
SETLOCAL
SET "SELF=%~dp0burnlink.js"
node "%SELF%" %*
ENDLOCAL