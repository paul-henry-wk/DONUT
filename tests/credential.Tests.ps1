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

Describe "Get-StoredPAT" {
    It "Returns environment variable when credential manager has no entry" {
        InModuleScope credential {
            Mock cmdkey { return "no entry" }
            Mock Get-Module { return $null }
            $originalEnv = [System.Environment]::GetEnvironmentVariable("DONUT_AZDO_TOKEN", "User")
            try {
                [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", "env-token-value", "User")
                $result = Get-StoredPAT -Organization "testorg"
                $result | Should -Be "env-token-value"
            } finally {
                [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", $originalEnv, "User")
            }
        }
    }

    It "Returns null when no credential and no environment variable" {
        InModuleScope credential {
            Mock cmdkey { return "no entry" }
            Mock Get-Module { return $null }
            $originalEnv = [System.Environment]::GetEnvironmentVariable("DONUT_AZDO_TOKEN", "User")
            try {
                [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", $null, "User")
                $result = Get-StoredPAT -Organization "testorg"
                $result | Should -BeNullOrEmpty
            } finally {
                [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", $originalEnv, "User")
            }
        }
    }
}

Describe "Set-StoredPAT" {
    It "Calls cmdkey to store the credential" {
        InModuleScope credential {
            Mock cmdkey { }
            $originalEnv = [System.Environment]::GetEnvironmentVariable("DONUT_AZDO_TOKEN", "User")
            try {
                $result = Set-StoredPAT -Token "my-secret-token" -Organization "testorg"
                $result | Should -BeTrue
                Should -Invoke cmdkey -Times 1 -ParameterFilter {
                    $args -contains '/add:DONUT_AzDo_PAT_testorg'
                }
            } finally {
                [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", $originalEnv, "User")
            }
        }
    }

    It "Falls back to environment variable when cmdkey fails" {
        InModuleScope credential {
            Mock cmdkey { throw "cmdkey not available" }
            $originalEnv = [System.Environment]::GetEnvironmentVariable("DONUT_AZDO_TOKEN", "User")
            try {
                $result = Set-StoredPAT -Token "fallback-token" -Organization "testorg"
                $result | Should -BeTrue
                $envVal = [System.Environment]::GetEnvironmentVariable("DONUT_AZDO_TOKEN", "User")
                $envVal | Should -Be "fallback-token"
            } finally {
                [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", $originalEnv, "User")
            }
        }
    }
}

Describe "Remove-StoredPAT" {
    It "Calls cmdkey /delete to remove the credential" {
        InModuleScope credential {
            Mock cmdkey { }
            $originalEnv = [System.Environment]::GetEnvironmentVariable("DONUT_AZDO_TOKEN", "User")
            try {
                [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", "to-be-removed", "User")
                Remove-StoredPAT -Organization "testorg"
                Should -Invoke cmdkey -Times 1 -ParameterFilter {
                    $args -contains '/delete:DONUT_AzDo_PAT_testorg'
                }
                $envVal = [System.Environment]::GetEnvironmentVariable("DONUT_AZDO_TOKEN", "User")
                $envVal | Should -BeNullOrEmpty
            } finally {
                [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", $originalEnv, "User")
            }
        }
    }

    It "Clears environment variable even when cmdkey fails" {
        InModuleScope credential {
            Mock cmdkey { throw "cmdkey failed" }
            $originalEnv = [System.Environment]::GetEnvironmentVariable("DONUT_AZDO_TOKEN", "User")
            try {
                [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", "should-be-cleared", "User")
                Remove-StoredPAT -Organization "testorg"
                $envVal = [System.Environment]::GetEnvironmentVariable("DONUT_AZDO_TOKEN", "User")
                $envVal | Should -BeNullOrEmpty
            } finally {
                [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", $originalEnv, "User")
            }
        }
    }
}
