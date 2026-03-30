@echo off
title DONUT - DevOps Nabsic Unified Tool
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0donut.ps1" %*
pause
