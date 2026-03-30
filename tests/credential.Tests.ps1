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
        Mock Get-StoredPAT { return "stored-token-value-that-is-long-enough-for-validation" }
        $result = Resolve-PAT -ConfigToken "STORED"
        $result | Should -Be "stored-token-value-that-is-long-enough-for-validation"
    }

    It "Rejects short tokens and falls back to stored credential" {
        Mock Get-StoredPAT { return "a" * 52 }
        $result = Resolve-PAT -ConfigToken "short"
        $result | Should -Be ("a" * 52)
    }

    It "Rejects tokens with special characters" {
        Mock Get-StoredPAT { return "a" * 52 }
        $result = Resolve-PAT -ConfigToken ("a" * 50 + "!@")
        $result | Should -Be ("a" * 52)
    }
}
