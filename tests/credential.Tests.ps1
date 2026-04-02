BeforeAll {
    $ModulePath = "$PSScriptRoot\..\cli\modules"
    Import-Module "$ModulePath\credential" -Force
}

Describe "Resolve-PAT" {
    It "Returns config token when valid PAT format (52+ alphanumeric chars)" {
        $validPAT = "a" * 52
        $result = Resolve-PAT -ConfigToken $validPAT
        $result | Should -Be $validPAT
    }

    It "Rejects token marked as STORED" {
        InModuleScope credential {
            Mock Get-StoredPAT { return "stored-token-value-that-is-long-enough-for-validation" }
            Mock Read-Host { return "" }
            $result = Resolve-PAT -ConfigToken "STORED"
            $result | Should -Be "stored-token-value-that-is-long-enough-for-validation"
        }
    }

    It "Rejects short tokens and falls back to stored credential" {
        InModuleScope credential {
            Mock Get-StoredPAT { return ("a" * 52) }
            Mock Read-Host { return "" }
            $result = Resolve-PAT -ConfigToken "short"
            $result | Should -Be ("a" * 52)
        }
    }

    It "Accepts long tokens regardless of special characters" {
        # Resolve-PAT only checks length >= 10, not character content
        $token = "a" * 50 + "!@"
        $result = Resolve-PAT -ConfigToken $token
        $result | Should -Be $token
    }
}
