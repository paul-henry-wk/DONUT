# using module "..\modules\http-request.psm1"
# using module "..\modules\print.psm1"
$ErrorActionPreference = "Stop"
$AzDoAPIVersion = "api-version=7.0"
$IdentifierContainer = "___identifier = (.*)___"
$ContentSeparator = "<===== DONUT == The content between these tags is automatically generated =====>"

function GetApiHeaders {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $AzDoToken,
        [bool] $Patch = $false
    )

    return @{
        Authorization = "Basic " + [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes(":$AzDoToken"))
        "Content-Type" = if ($Patch) { "application/json-patch+json" } else { "application/json" }
    }
}

function GetConfigFile {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $FilePath,
        [Parameter(Mandatory = $true)]
        [string] $AzDoBaseURI,
        [Parameter(Mandatory = $true)]
        [string] $AzDoToken,
        [string] $AzDoRepository = ""
    )

    Print_Text "Get '$FilePath' file from Azure DevOps repository."
    $Parameters = @{
        Headers = (GetApiHeaders -AzDoToken $AzDoToken)
        Method = "GET"
        Uri = "$AzDoBaseURI/_apis/git/repositories/$AzDoRepository/items?path=/$FilePath&versionDescriptor.versionType=branch&versionDescriptor.version=main&$AzDoAPIVersion"
    }

    try {
        return SendRestRequest -Parameters $Parameters
    } catch {
        if ($_.Exception.Message -match "401|403|unauthorized") {
            throw "Failed to fetch '$FilePath' from Azure DevOps: PAT is expired or unauthorized. Update your token in DONUT config."
        }
        throw "Failed to fetch '$FilePath' from Azure DevOps: $($_.Exception.Message)"
    }
}

function IsValidRepository {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $Repository,
        [Parameter(Mandatory = $true)]
        [string] $ExpectedOriginURI
    )

    if (Test-Path -Path $Repository) { # Folder exists
        if (-Not ($null -eq (git -C "$Repository" rev-parse --is-inside-git-dir))) { # Is a git repository
            if ($ExpectedOriginURI -eq (git -C "$Repository" remote get-url origin)) { # Has expected origin
                return $true
            }
        }

        Print_Warning "Repository found but is corrupted (not a git repository or wrong origin). It needs to be deleted before a new clone is done."
        Print_Request "Stop the script now if you don't want the deletion to happen."
        Remove-Item "$Repository" -Force  -Recurse
        Print_Text "Repository deleted."
        return $false
    } else {
        return $false
    }
}

function CloneRepository {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $AzDoBaseURI,
        [Parameter(Mandatory = $true)]
        [string] $AzDoRepository,
        [Parameter(Mandatory = $true)]
        [string] $Repository,
        [Parameter(Mandatory = $true)]
        [string] $Username,
        [Parameter(Mandatory = $true)]
        [string] $Email,
        [bool] $IsBare = $false
    )

    Print_Title "Clone '$AzDoRepository' Repository in '$Repository'."
    $OriginURI = "$AzDoBaseURI/_git/$AzDoRepository"

    if (IsValidRepository -Repository $Repository -ExpectedOriginURI $OriginURI) {
        Print_Status "Repository already created."
    } else {
        if ($IsBare) {
            git clone --bare "$OriginURI" "$Repository" | Out-Host
            git -C "$Repository" config remote.origin.fetch +refs/heads/*:refs/remotes/origin/* | Out-Host
        } else {
            git clone "$OriginURI" "$Repository" | Out-Host
        }
        Print_Status "Repository created."
    }

    SetLocalGitUser -Repository $Repository -Username $Username -Email $Email
}

function SetLocalGitUser {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $Repository,
        [Parameter(Mandatory = $true)]
        [string] $Username,
        [Parameter(Mandatory = $true)]
        [string] $Email
    )

    Print_Title "Set git user's name and email in Repository '$Repository'"
    git -C "$Repository" config user.name "$Username" | Out-Host
    git -C "$Repository" config user.email "$Email" | Out-Host
}

function GetWorkItem {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $WorkitemId,
        [Parameter(Mandatory = $true)]
        [string] $AzDoBaseURI,
        [Parameter(Mandatory = $true)]
        [string] $AzDoToken
    )

    Print_Title "Get workitem '$WorkitemId'"
    $URI = "$AzDoBaseURI/_apis/wit/workitems/$WorkitemId"
    $ApiHeaders = GetApiHeaders -AzDoToken $AzDoToken

    $Parameters = @{
        Headers = $ApiHeaders
        Method = "GET"
        Uri = "$($URI)?$AzDoAPIVersion&errorPolicy=omit"
    }

    try {
        $Response = SendRestRequest -Parameters $Parameters
    } catch {
        if ($_.Exception.Message -match "401|403|unauthorized") {
            throw "Work item #$($WorkitemId): PAT expired. Update your token in Config > azdo.token"
        } elseif ($_.Exception.Message -match "404|not found") {
            throw "Work item #$($WorkitemId) not found. Check the ID in Config > workitem_id"
        }
        throw "Work item #$($WorkitemId) fetch failed: $($_.Exception.Message)"
    }

    Print_Status "Workitem found"
    return @{
        id = $WorkitemId
        title = $Response.fields."System.Title"
        url = $Response.url
    }
}

function CreatePullRequest {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $AzDoRepository,
        [Parameter(Mandatory = $true)]
        [string] $sourceBranch,
        [Parameter(Mandatory = $true)]
        [string] $targetBranch,
        [Parameter(Mandatory = $true)]
        [string] $AzDoBaseURI,
        [Parameter(Mandatory = $true)]
        [string] $AzDoToken,
        [Parameter(Mandatory = $true)]
        [string] $Title,
        [string] $Description,
        [string] $Identifier,
        [hashtable] $Workitem
    )

    Print_Title "Look for an existing Pull Request in repository '$AzDoRepository' from '$sourceBranch' to '$targetBranch'."
    $PR_URI = "$AzDoBaseURI/_apis/git/repositories/$AzDoRepository/pullrequests"
    $ApiHeaders = GetApiHeaders -AzDoToken $AzDoToken

    $PR_sourceRefName = [uri]::EscapeDataString("refs/heads/$sourceBranch")
    $PR_targetRefName = [uri]::EscapeDataString("refs/heads/$targetBranch")

    $PR_Parameters = @{
        Headers = $ApiHeaders
        Method = "GET"
        Uri = "$($PR_URI)?$AzDoAPIVersion&searchCriteria.sourceRefName=$PR_sourceRefName&searchCriteria.targetRefName=$PR_targetRefName"
    }

    try {
        $PR_Response = SendRestRequest -Parameters $PR_Parameters
    } catch {
        if ($_.Exception.Message -match "401|403|unauthorized") {
            throw "Pull request query failed on '$AzDoRepository': PAT expired. Update your token in Config > azdo.token"
        }
        throw "Pull request query failed on '$AzDoRepository': $($_.Exception.Message)"
    }

    if ($PR_Response."count" -eq 1) {
        $PR = $PR_Response.value[0]
        $PR_Id = $PR.pullRequestId
        Print_Status "Pull Request found (Id = $PR_Id)."
        
        if ($Identifier) {
            $PR_Identifier = $PR.description -Replace "(.|\s)*$($IdentifierContainer)(.|\s)*", '$2'

            if ($Identifier -ne $PR_Identifier) {
                Print_Status "A new configuration has been detected. The Pull Request needs to be updated."
                $PR_updateBody = @{
                    description = PR_BuildNewDescription -Content $Description -Identifier $Identifier -CurrentDescription $PR.description
                }

                $PR_UpdateParameters = @{
                    Headers = $ApiHeaders
                    Method = "PATCH"
                    Uri = "$PR_URI/$($PR_Id)?$AzDoAPIVersion"
                    Body = $PR_updateBody | ConvertTo-Json -Depth 10 -Compress
                }

                SendRestRequest -Parameters $PR_UpdateParameters | Out-Null
                Print_Status "Pull Request Updated."
            }
        }

        if ($Workitem) {
            PR_LinkWorkitem -AzDoBaseURI $AzDoBaseURI -AzDoRepository $AzDoRepository -AzDoToken $AzDoToken -PR_Id $PR_Id -Workitem $Workitem
        }
    } else {
        Print_Status "No Pull Request found. Creating a new one."
        $PR_CreateBody = @{
            sourceRefName = "refs/heads/$sourceBranch"
            targetRefName = "refs/heads/$targetBranch"
            title = $Title
            description = PR_BuildNewDescription -Content $Description -Identifier $Identifier
        }
        if ($Workitem) {
            $PR_CreateBody["workItemRefs"] = @($Workitem)
        }

        $PR_Parameters = @{
            Headers = $ApiHeaders
            Method = "POST"
            Uri = "$($PR_URI)?$AzDoAPIVersion"
            Body = $PR_CreateBody | ConvertTo-Json -Depth 10 -Compress
        }

        try {
            $PR_CreateResponse = SendRestRequest -Parameters $PR_Parameters
        } catch {
            throw "Failed to create pull request on '$AzDoRepository' from '$sourceBranch' to '$targetBranch': $($_.Exception.Message)"
        }
        $PR_Id = $PR_CreateResponse."pullRequestId"
        Print_Status "Pull Request Created (Id = $PR_Id)."
    }

    return $PR_Id
}

function PR_BuildNewDescription  {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $Content,
        [string] $Identifier,
        [string] $CurrentDescription
    )

    if ( $Identifier ) {
        $GeneratedContent = "$Content`n`n$($IdentifierContainer.replace("(.*)", $Identifier))"
    } else {
        $GeneratedContent = $Content
    }
    $GeneratedContent = "`n`n$GeneratedContent`n`n"
    
    $DescriptionParts = if ($CurrentDescription) { $CurrentDescription -split "($ContentSeparator)" } else { @() }

    if ($DescriptionParts.Count -ge 5) {
        $DescriptionParts[2] = $GeneratedContent
        return $DescriptionParts -join ''
    } else {
        $Description = $DescriptionParts -join ''
        if ($Description.Length -gt 0 -and $Description.Substring($Description.Length - 1) -ne "`n") {
            $Description += "`n"
        }
        return @($Description, $ContentSeparator, $GeneratedContent, $ContentSeparator) -join ''
    }
}

function PR_LinkWorkitem  {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $AzDoBaseURI,
        [Parameter(Mandatory = $true)]
        [string] $AzDoRepository,
        [Parameter(Mandatory = $true)]
        [string] $AzDoToken,
        [Parameter(Mandatory = $true)]
        [string] $PR_Id,
        [hashtable] $Workitem
    )

    $ApiHeaders = GetApiHeaders -AzDoToken $AzDoToken -Patch $true

    $PR_Full_URI = "$AzDoBaseURI/_apis/git/repositories/$AzDoRepository/pullrequests/$PR_Id"
    $PR_Full_Parameters = @{
        Headers = $ApiHeaders
        Method = "GET"
        Uri = "$($PR_Full_URI)?$AzDoAPIVersion&includeWorkItemRefs=$true"
    }

    $PR_Full = SendRestRequest -Parameters $PR_Full_Parameters
    $WI_Linked = $PR_Full.workItemRefs.Where({ $_.id -eq $Workitem.id}).Count -gt 0

    if ($WI_Linked) { return }
    
    Print_Status "Link Workitem '$($Workitem.id)' to the Pull Request"
    $WI_URI = "$AzDoBaseURI/_apis/wit/workitems/$($Workitem.id)"
    $WI_Body = @(@{
        "op"= "add"
        "path" = "/relations/-"
        "value" = @{
            "rel" = "ArtifactLink"
            "url" = $PR_Full.artifactId
            "attributes" = @{ "name" = "Pull Request" }
        }
    })
    
    $PR_WI_Parameters = @{
        Headers = $ApiHeaders
        Method = "PATCH"
        Uri = "$($WI_URI)?$AzDoAPIVersion"
        Body = ConvertTo-Json -InputObject $WI_Body -Depth 10 -Compress
    }
    SendRestRequest -Parameters $PR_WI_Parameters | Out-Null
}

Export-ModuleMember -Function GetApiHeaders
Export-ModuleMember -Function GetConfigFile
Export-ModuleMember -Function CloneRepository
Export-ModuleMember -Function SetLocalGitUser
Export-ModuleMember -Function GetWorkItem
Export-ModuleMember -Function CreatePullRequest
