BeforeAll {
    $ModulePath = "$PSScriptRoot\..\cli\modules"
    Import-Module "$ModulePath\print" -Force
    Import-Module "$ModulePath\http-request" -Force
    Import-Module "$ModulePath\azure" -Force
}

Describe "GetApiHeaders" {
    It "Returns Authorization header with Base64 encoded token" {
        $headers = GetApiHeaders -AzDoToken "test-token"
        $headers.Authorization | Should -BeLike "Basic *"
        $headers."Content-Type" | Should -Be "application/json"
    }

    It "Returns patch content type when Patch is true" {
        $headers = GetApiHeaders -AzDoToken "test-token" -Patch $true
        $headers."Content-Type" | Should -Be "application/json-patch+json"
    }

    It "Encodes token correctly" {
        $headers = GetApiHeaders -AzDoToken "mytoken"
        $expected = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes(":mytoken"))
        $headers.Authorization | Should -Be "Basic $expected"
    }
}

Describe "IsValidRepository" {
    It "Returns false when path does not exist" {
        $result = IsValidRepository -Repository "C:\nonexistent\path\12345" -ExpectedOriginURI "https://example.com"
        $result | Should -Be $false
    }
}

Describe "PR_BuildNewDescription" {
    It "Generates description with identifier" {
        $result = PR_BuildNewDescription -Content "Test content" -Identifier "abc123"
        $result | Should -BeLike "*Test content*"
        $result | Should -BeLike "*abc123*"
    }

    It "Generates description without identifier" {
        $result = PR_BuildNewDescription -Content "Test content"
        $result | Should -BeLike "*Test content*"
    }

    It "Updates existing description between separators" {
        $sep = "<===== DONUT == The content between these tags is automatically generated =====>"
        $existing = "User text`n$sep`n`nOld content`n`n$sep"
        $result = PR_BuildNewDescription -Content "New content" -Identifier "id1" -CurrentDescription $existing
        $result | Should -BeLike "*New content*"
        $result | Should -BeLike "*User text*"
    }
}

Describe "GetConfigFile" {
    BeforeEach {
        Mock SendRestRequest { return @{ content = "file-content" } } -ModuleName azure
        Mock Print_Text { } -ModuleName azure
    }

    It "Calls SendRestRequest with correct parameters" {
        $result = GetConfigFile -FilePath "config.json" -AzDoBaseURI "https://dev.azure.com/org/project" -AzDoToken "test-token"

        Should -Invoke SendRestRequest -Times 1 -ModuleName azure
        $result.content | Should -Be "file-content"
    }

    It "Throws PAT message on 401 error" {
        Mock SendRestRequest { throw "401 Unauthorized" } -ModuleName azure

        { GetConfigFile -FilePath "config.json" -AzDoBaseURI "https://dev.azure.com/org/project" -AzDoToken "bad-token" } |
            Should -Throw "*PAT*"
    }

    It "Throws PAT message on 403 error" {
        Mock SendRestRequest { throw "403 Forbidden" } -ModuleName azure

        { GetConfigFile -FilePath "config.json" -AzDoBaseURI "https://dev.azure.com/org/project" -AzDoToken "bad-token" } |
            Should -Throw "*PAT*"
    }

    It "Re-throws other errors" {
        Mock SendRestRequest { throw "500 Internal Server Error" } -ModuleName azure

        { GetConfigFile -FilePath "config.json" -AzDoBaseURI "https://dev.azure.com/org/project" -AzDoToken "test-token" } |
            Should -Throw "*500 Internal Server Error*"
    }
}

Describe "GetWorkItem" {
    BeforeEach {
        Mock Print_Title { } -ModuleName azure
        Mock Print_Status { } -ModuleName azure
    }

    It "Returns hashtable with id, title, and url" {
        Mock SendRestRequest {
            return @{
                fields = @{ "System.Title" = "My Work Item" }
                url    = "https://dev.azure.com/org/project/_apis/wit/workitems/123"
            }
        } -ModuleName azure

        $result = GetWorkItem -WorkitemId "123" -AzDoBaseURI "https://dev.azure.com/org/project" -AzDoToken "test-token"

        $result.id | Should -Be "123"
        $result.title | Should -Be "My Work Item"
        $result.url | Should -Be "https://dev.azure.com/org/project/_apis/wit/workitems/123"
        Should -Invoke SendRestRequest -Times 1 -ModuleName azure
    }

    It "Throws PAT message on 401 error" {
        Mock SendRestRequest { throw "401 Unauthorized" } -ModuleName azure

        { GetWorkItem -WorkitemId "123" -AzDoBaseURI "https://dev.azure.com/org/project" -AzDoToken "bad-token" } |
            Should -Throw "*PAT*"
    }

    It "Throws not found message on 404 error" {
        Mock SendRestRequest { throw "404 Not Found" } -ModuleName azure

        { GetWorkItem -WorkitemId "999" -AzDoBaseURI "https://dev.azure.com/org/project" -AzDoToken "test-token" } |
            Should -Throw "*not found*"
    }

    It "Re-throws other errors" {
        Mock SendRestRequest { throw "503 Service Unavailable" } -ModuleName azure

        { GetWorkItem -WorkitemId "123" -AzDoBaseURI "https://dev.azure.com/org/project" -AzDoToken "test-token" } |
            Should -Throw "*503 Service Unavailable*"
    }
}

Describe "SetLocalGitUser" {
    BeforeEach {
        Mock git { $global:LASTEXITCODE = 0 } -ModuleName azure
        Mock Print_Title { } -ModuleName azure
    }

    It "Calls git config for user.name and user.email" {
        SetLocalGitUser -Repository "C:\repo" -Username "Test User" -Email "test@example.com"

        Should -Invoke git -Times 1 -ModuleName azure -ParameterFilter {
            $args -contains 'config' -and $args -contains 'user.name' -and $args -contains 'Test User'
        }
        Should -Invoke git -Times 1 -ModuleName azure -ParameterFilter {
            $args -contains 'config' -and $args -contains 'user.email' -and $args -contains 'test@example.com'
        }
    }
}
