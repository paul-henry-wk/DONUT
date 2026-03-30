# using module "..\modules\print.psm1"
$ErrorActionPreference = "Stop"

function WriteSessionLog {
    param([string] $FilePath, [string] $Message)
    if ($FilePath) {
        $dir = Split-Path $FilePath -Parent
        if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Add-Content -Path $FilePath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    }
}

function SendRestRequest {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $Parameters,
        [hashtable] $StoredSession
    )

    # Retrieve stored Session if there is one
    if ($StoredSession) {
        WriteSessionLog -FilePath $StoredSession.Logs -Message "HTTP REQUEST USING SESSION : $($Parameters.Uri)"

        if (Test-Path $StoredSession.Cookies -PathType leaf) {
            $SessionData = Get-Content -Raw -Path $StoredSession.Cookies | ConvertFrom-Json -AsHashtable
            $Session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()

            foreach ($Cookie in $SessionData.cookies) {
                $Session.Cookies.Add([System.Net.Cookie]::new($Cookie.Name, $Cookie.Value, $Cookie.Path, $Cookie.Domain))
            }

            WriteSessionLog -FilePath $StoredSession.Logs -Message "RETRIEVED SESSION : $($Session.Cookies.GetAllCookies())"
            $Parameters.WebSession = $Session
        } else {
            WriteSessionLog -FilePath $StoredSession.Logs -Message "NEW SESSION"
            $Parameters.SessionVariable = 'NewSession'
        }
    }

    # Send the request
    $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $Parameters.StatusCodeVariable = 'StatusCode'
        $Response = Invoke-RestMethod @Parameters
    } catch {
        $StatusCode = $_.Exception.Response.StatusCode.value__
        $ErrorMessage = $_
    } finally {
        $Stopwatch.Stop()
        Print_Text "Json service executed in $($Stopwatch.Elapsed)"
    }

    if ($null -eq $StatusCode -or $StatusCode -ge 300) {
        if ($StoredSession) {
            WriteSessionLog -FilePath $StoredSession.Logs -Message "ERROR : Request failed, status code: $StatusCode, message: '$ErrorMessage'"
        }
        throw "Request failed, status code: $StatusCode, message: '$ErrorMessage'"
    }

    # Store the Session
    if ($StoredSession) {
        if ($Parameters.SessionVariable) {
            $Session = $NewSession
        }

        $SessionToStore = @{cookies = @()}

        foreach ($Cookie in $Session.Cookies.GetAllCookies()) {
            $SessionToStore.cookies += @{ "Name" = $Cookie.Name; "Value" = $Cookie.Value; "Path" = $Cookie.Path; "Domain" = $Cookie.Domain }
        }

        New-Item -Path $StoredSession.Cookies -ItemType "file" -Value ($SessionToStore | ConvertTo-Json -Depth 10) -Force | Out-Null
    }
    if ($StoredSession) { WriteSessionLog -FilePath $StoredSession.Logs -Message "STORED SESSION : $($Session.Cookies.GetAllCookies())" }

    $Response
}

function SendRestRequestToEnablon {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $Uri,
        [Parameter(Mandatory = $true)]
        [hashtable] $Body,
        [Parameter(Mandatory = $true)]
        [hashtable] $Authentication,
        [Parameter(Mandatory = $true)]
        [hashtable] $StoredSession,
        [bool] $ForceNewSession = $false,
        [int] $RetryCount = 0
    )

    $CreateNewSession = $ForceNewSession -or -not (Test-Path $StoredSession.Cookies -PathType leaf)
    if ($CreateNewSession) {
        $Body.authentication = $Authentication
    }

    $Parameters = @{
        Method = "POST"
        Uri = $Uri
        ContentType = "application/json; charset=utf-8"
        Body = $Body | ConvertTo-Json -Depth 10 -Compress
    }

    $Response = SendRestRequest -Parameters $Parameters -StoredSession $StoredSession

    if ("OK" -ne $Response."status") {
        WriteSessionLog -FilePath $StoredSession.Logs -Message "ERROR: Enablon Request failed, status code: 200, Enablon status code: '$($Response."status")', message: '$($Response."error")'"

        # In case of a failure because of authentication, try to create a new session (max 1 retry)
        if (-not $CreateNewSession -and $RetryCount -lt 1 -and $Response."error".Contains("authentication", "InvariantCultureIgnoreCase")) {
            if ((Get-Item -Path $StoredSession.Cookies).CreationTime -gt (Get-Date).AddMinutes(-5)) {
                Print_Warning "The stored Enablon session cookie was not recognized multiple times in a short period of time. It may mean that you forgot to uncheck the 'Force SSL' option in the WizManager."
            }

            WriteSessionLog -FilePath $StoredSession.Logs -Message "WARNING : RESET SESSION"
            (Get-Item -Path $StoredSession.Cookies).CreationTime = Get-Date
            Remove-Item -Path $StoredSession.Cookies

            $Response = SendRestRequestToEnablon -Uri $Uri -Body $Body -Authentication $Authentication -StoredSession $StoredSession -ForceNewSession $true -RetryCount ($RetryCount + 1)
        } else {
            throw $Response."error"
        }
    }

    $Response
}

function SendWebRequest {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $Parameters,
        [Parameter(Mandatory = $true)]
        [ref] $WebSession
    )

    $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        if ($WebSession.Value) {
            $Parameters.WebSession = $WebSession.Value
        } elseif ($WebSession) {
            $Parameters.SessionVariable = 'session'
        }

        $Response = Invoke-WebRequest @Parameters
        $StatusCode = $Response.StatusCode

        if ($Parameters.SessionVariable) {
            $WebSession.Value = $session
        }
    } catch {
        $StatusCode = $_.Exception.Response.StatusCode.value__
        $ErrorMessage = $_
    } finally {
        $Stopwatch.Stop()
        Print_Text "Web request executed in $($Stopwatch.Elapsed)"
    }

    if ($StatusCode -ge 300) {
        throw "Request failed, status code: $StatusCode, message: '$ErrorMessage'"
    }

    $Response
}

Export-ModuleMember -Function SendRestRequest
Export-ModuleMember -Function SendRestRequestToEnablon
Export-ModuleMember -Function SendWebRequest
