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
