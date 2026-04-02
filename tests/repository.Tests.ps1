BeforeAll {
    $ModulePath = "$PSScriptRoot\..\cli\modules"
    Import-Module "$ModulePath\print" -Force
    Import-Module "$ModulePath\repository" -Force
}

Describe 'CheckoutBranch' {
    BeforeEach {
        Mock git { } -ModuleName repository
        Mock Write-Host { } -ModuleName repository
        Mock Print_Text { } -ModuleName repository
        Mock Print_SubTitle { } -ModuleName repository
        Mock Print_Status { } -ModuleName repository
    }

    It 'should checkout existing remote branch and pull' {
        Mock git {
            if ($args -contains 'show-ref' -and $args -contains 'refs/remotes/origin/feature/test') { return 'abc123' }
            if ($args -contains 'show-ref' -and $args -contains 'refs/heads/feature/test') { return $null }
        } -ModuleName repository

        $all = @(CheckoutBranch -Repository 'C:\repo' -SourceBranch 'main' -Branch 'feature/test')
        # Function may emit Print output into pipeline; the boolean is always last
        $all[-1] | Should -BeTrue
    }

    It 'should create new branch from source when branch does not exist' {
        Mock git {
            if ($args -contains 'show-ref') { return $null }
        } -ModuleName repository

        $all = @(CheckoutBranch -Repository 'C:\repo' -SourceBranch 'main' -Branch 'feature/new')
        $all[-1] | Should -BeFalse
    }

    It 'should throw when ExpectedToExist is true and branch not found' {
        Mock git {
            if ($args -contains 'show-ref') { return $null }
        } -ModuleName repository

        { CheckoutBranch -Repository 'C:\repo' -SourceBranch 'main' -Branch 'feature/missing' -ExpectedToExist $true } |
            Should -Throw
    }
}

Describe 'EmptyCommitsFolder' {
    BeforeEach {
        Mock git { } -ModuleName repository
        Mock Write-Host { } -ModuleName repository
        Mock Print_Text { } -ModuleName repository
        Mock Remove-Item { } -ModuleName repository
    }

    It 'should clean commits folder when it has content' {
        Mock Test-Path { return $true } -ModuleName repository

        EmptyCommitsFolder -Repository 'C:\repo'

        Should -Invoke Remove-Item -Times 1 -ModuleName repository
        Should -Invoke git -Times 1 -ModuleName repository
    }

    It 'should skip when commits folder is empty' {
        Mock Test-Path { return $false } -ModuleName repository

        EmptyCommitsFolder -Repository 'C:\repo'

        Should -Invoke Remove-Item -Times 0 -ModuleName repository
    }
}

Describe 'Commit' {
    BeforeEach {
        Mock git { } -ModuleName repository
        Mock Write-Host { } -ModuleName repository
        Mock Print_Text { } -ModuleName repository
    }

    It 'should call git commit with message' {
        Commit -Repository 'C:\repo' -Message 'test commit'

        Should -Invoke git -Times 1 -ModuleName repository -ParameterFilter {
            $args -contains 'commit' -and $args -contains 'test commit'
        }
    }
}

Describe 'Push' {
    BeforeEach {
        Mock git { } -ModuleName repository
        Mock Write-Host { } -ModuleName repository
        Mock Print_Text { } -ModuleName repository
    }

    It 'should push to origin with branch name' {
        Push -Repository 'C:\repo' -AzDoRepository 'Package.Risk' -Branch 'feature/test'

        Should -Invoke git -Times 1 -ModuleName repository -ParameterFilter {
            $args -contains 'push' -and $args -contains 'feature/test'
        }
    }
}
