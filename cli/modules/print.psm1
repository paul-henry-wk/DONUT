$ErrorActionPreference = "Stop"

# ── Gum detection ──
$script:UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)
$script:IsGUI = $env:DONUT_GUI -eq "1"

# ── Output functions ──
# In DONUT GUI mode, prefix lines with tags so the terminal can classify them reliably
# Tags: [TITLE] [STATUS] [WARN] [ERR] [SUB] [END]

function Print_Text {
    [CmdletBinding()]
    param ([string] $Message)

    if ($script:IsGUI) {
        Write-Host $Message
    } elseif ($script:UseGum) {
        gum style --faint $Message
    } else {
        Write-Host $Message
    }
}

function Print_Title {
    [CmdletBinding()]
    param ([string] $Message)

    Write-Host
    if ($script:IsGUI) {
        Write-Host "[TITLE] $Message"
    } elseif ($script:UseGum) {
        gum style --foreground 212 --bold $Message
    } else {
        Write-Host $Message -ForegroundColor Magenta
    }
}

function Print_SubTitle {
    [CmdletBinding()]
    param ([string] $Message)

    if ($script:IsGUI) {
        Write-Host "[SUB] $Message"
    } elseif ($script:UseGum) {
        gum style --foreground 10 $Message
    } else {
        Write-Host $Message -ForegroundColor Green
    }
}

function Print_Status {
    [CmdletBinding()]
    param ([string] $Message)

    if ($script:IsGUI) {
        Write-Host "[STATUS] $Message"
    } elseif ($script:UseGum) {
        gum style --foreground 212 $Message
    } else {
        Write-Host $Message -ForegroundColor Magenta
    }
}

function Print_Warning {
    [CmdletBinding()]
    param ([string] $Message)

    if ($script:IsGUI) {
        Write-Host "[WARN] $Message"
    } elseif ($script:UseGum) {
        gum style --foreground 214 $Message
    } else {
        Write-Host $Message -ForegroundColor DarkYellow
    }
}

function Print_Error {
    [CmdletBinding()]
    param ([string] $Message)

    if ($script:IsGUI) {
        Write-Host "[ERR] $Message"
    } elseif ($script:UseGum) {
        gum style --foreground 196 --bold $Message
    } else {
        Write-Host $Message -ForegroundColor Red
    }
}

function Print_Request {
    [CmdletBinding()]
    param ([string] $Message)

    # Auto-continue when running inside DONUT GUI (no interactive stdin)
    if ($script:IsGUI) {
        if ($Message) { Write-Host $Message }
        return
    }

    if ($script:UseGum) {
        $prompt = if ($Message) { $Message } else { "Continue?" }
        $result = gum confirm $prompt --default=Yes 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Cancelled by user."
        }
    } else {
        $Space = if ($Message) {" "} else {""}
        Write-Host "$Message$($Space)Press any key to continue or CTRL+C to quit." -ForegroundColor DarkGray -NoNewLine
        Read-Host | Out-Null
    }
}

function Print_Script_Title {
    [CmdletBinding()]
    param ([string] $Message)

    Write-Host
    if ($script:IsGUI) {
        Write-Host "[TITLE] $Message"
    } elseif ($script:UseGum) {
        gum style --border double --border-foreground 10 --padding "0 2" --bold --foreground 10 $Message
    } else {
        Write-Host $Message -ForegroundColor Green
    }
}

function Print_Script_End {
    [CmdletBinding()]
    param (
        [string] $Message,
        [string[]] $Links
    )

    Write-Host
    if ($script:IsGUI) {
        Write-Host "[END] $Message"
        foreach ($Link in $Links) {
            Write-Host $Link
        }
    } elseif ($script:UseGum) {
        $content = $Message
        foreach ($Link in $Links) {
            $content = "$content`n$Link"
        }
        gum style --border rounded --border-foreground 10 --padding "0 2" --foreground 10 $content
    } else {
        Write-Host $Message -ForegroundColor Green
        foreach ($Link in $Links) {
            Write-Host $Link
        }
    }
    Write-Host
}

Export-ModuleMember -Function Print_Text
Export-ModuleMember -Function Print_Title
Export-ModuleMember -Function Print_SubTitle
Export-ModuleMember -Function Print_Status
Export-ModuleMember -Function Print_Warning
Export-ModuleMember -Function Print_Error
Export-ModuleMember -Function Print_Request
Export-ModuleMember -Function Print_Script_Title
Export-ModuleMember -Function Print_Script_End
