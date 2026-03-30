BeforeAll {
    $ModulePath = "$PSScriptRoot\..\cli\modules"
    Import-Module "$ModulePath\print" -Force
    Import-Module "$ModulePath\load-config" -Force
}

Describe "ValidateCommitMessage" {
    It "Accepts valid commit messages" {
        { ValidateCommitMessage -Message "Fix bug in module" } | Should -Not -Throw
    }

    It "Accepts messages with common special characters" {
        { ValidateCommitMessage -Message "Fix: something (v1.0) - test [scope]" } | Should -Not -Throw
    }

    It 'Rejects messages with double quote' {
        { ValidateCommitMessage -Message 'Has "quotes"' } | Should -Throw
    }

    It "Rejects messages with pipe character" {
        { ValidateCommitMessage -Message "Has | pipe" } | Should -Throw
    }

    It "Rejects messages with section sign" {
        { ValidateCommitMessage -Message "Has § sign" } | Should -Throw
    }
}
