package github

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/github/github-mcp-server/pkg/translations"
	"github.com/google/go-github/v72/github"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/migueleliasweb/go-github-mock/src/mock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func Test_ListReleases(t *testing.T) {
	// Verify tool definition
	mockClient := github.NewClient(nil)
	tool, _ := ListReleases(stubGetClientFn(mockClient), translations.NullTranslationHelper)

	assert.Equal(t, "list_releases", tool.Name)
	assert.NotEmpty(t, tool.Description)
	assert.Contains(t, tool.InputSchema.Properties, "owner")
	assert.Contains(t, tool.InputSchema.Properties, "repo")
	assert.ElementsMatch(t, tool.InputSchema.Required, []string{"owner", "repo"})

	// Setup mock releases for success case
	mockReleases := []*github.RepositoryRelease{
		{
			ID:      github.Ptr(int64(1)),
			TagName: github.Ptr("v1.0.0"),
			Name:    github.Ptr("Release v1.0.0"),
			Body:    github.Ptr("Initial release"),
			Draft:   github.Ptr(false),
		},
		{
			ID:      github.Ptr(int64(2)),
			TagName: github.Ptr("v0.9.0"),
			Name:    github.Ptr("Release v0.9.0"),
			Body:    github.Ptr("Beta release"),
			Draft:   github.Ptr(true),
		},
	}

	tests := []struct {
		name           string
		mockedClient   *http.Client
		requestArgs    map[string]interface{}
		expectError    bool
		expectedResult []*github.RepositoryRelease
		expectedErrMsg string
	}{
		{
			name: "successful releases list",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.GetReposReleasesByOwnerByRepo,
					mockResponse(t, http.StatusOK, mockReleases),
				),
			),
			requestArgs: map[string]interface{}{
				"owner": "testowner",
				"repo":  "testrepo",
			},
			expectError:    false,
			expectedResult: mockReleases,
		},
		{
			name: "releases list fails",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.GetReposReleasesByOwnerByRepo,
					http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
						w.WriteHeader(http.StatusNotFound)
						_, _ = w.Write([]byte(`{"message": "Not Found"}`))
					}),
				),
			),
			requestArgs: map[string]interface{}{
				"owner": "testowner",
				"repo":  "testrepo",
			},
			expectError:    true,
			expectedErrMsg: "failed to list releases",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Setup client with mock
			client := github.NewClient(tc.mockedClient)
			_, handler := ListReleases(stubGetClientFn(client), translations.NullTranslationHelper)

			// Create call request
			request := createMCPRequest(tc.requestArgs)

			// Call handler
			result, err := handler(context.Background(), request)

			// Verify results
			if tc.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.expectedErrMsg)
				return
			}

			require.NoError(t, err)

			// Parse the result and get the text content if no error
			textContent := getTextResult(t, result)
			var returnedReleases []*github.RepositoryRelease
			err = json.Unmarshal([]byte(textContent.Text), &returnedReleases)
			require.NoError(t, err)
			assert.Len(t, returnedReleases, len(tc.expectedResult))
		})
	}

	// Test missing parameter cases
	testCases := []struct {
		name string
		args map[string]interface{}
		want *mcp.CallToolResult
	}{
		{
			name: "missing owner",
			args: map[string]interface{}{
				"repo": "testrepo",
			},
			want: mcp.NewToolResultError("missing required parameter: owner"),
		},
		{
			name: "missing repo",
			args: map[string]interface{}{
				"owner": "testowner",
			},
			want: mcp.NewToolResultError("missing required parameter: repo"),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockClient := github.NewClient(nil)
			_, handler := ListReleases(stubGetClientFn(mockClient), translations.NullTranslationHelper)
			request := createMCPRequest(tc.args)
			got, err := handler(context.Background(), request)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func Test_CreateRelease(t *testing.T) {
	// Verify tool definition
	mockClient := github.NewClient(nil)
	tool, _ := CreateRelease(stubGetClientFn(mockClient), translations.NullTranslationHelper)

	assert.Equal(t, "create_release", tool.Name)
	assert.NotEmpty(t, tool.Description)
	assert.Contains(t, tool.InputSchema.Properties, "owner")
	assert.Contains(t, tool.InputSchema.Properties, "repo")
	assert.Contains(t, tool.InputSchema.Properties, "tag_name")
	assert.ElementsMatch(t, tool.InputSchema.Required, []string{"owner", "repo", "tag_name"})

	// Setup mock release for success case
	mockRelease := &github.RepositoryRelease{
		ID:      github.Ptr(int64(1)),
		TagName: github.Ptr("v1.0.0"),
		Name:    github.Ptr("Release v1.0.0"),
		Body:    github.Ptr("Initial release"),
		Draft:   github.Ptr(false),
	}

	tests := []struct {
		name           string
		mockedClient   *http.Client
		requestArgs    map[string]interface{}
		expectError    bool
		expectedResult *github.RepositoryRelease
		expectedErrMsg string
	}{
		{
			name: "successful release creation",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.PostReposReleasesByOwnerByRepo,
					mockResponse(t, http.StatusCreated, mockRelease),
				),
			),
			requestArgs: map[string]interface{}{
				"owner":    "testowner",
				"repo":     "testrepo",
				"tag_name": "v1.0.0",
				"name":     "Release v1.0.0",
				"body":     "Initial release",
			},
			expectError:    false,
			expectedResult: mockRelease,
		},
		{
			name: "release creation fails",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.PostReposReleasesByOwnerByRepo,
					http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
						w.WriteHeader(http.StatusUnprocessableEntity)
						_, _ = w.Write([]byte(`{"message": "Validation Failed"}`))
					}),
				),
			),
			requestArgs: map[string]interface{}{
				"owner":    "testowner",
				"repo":     "testrepo",
				"tag_name": "v1.0.0",
			},
			expectError:    true,
			expectedErrMsg: "failed to create release",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Setup client with mock
			client := github.NewClient(tc.mockedClient)
			_, handler := CreateRelease(stubGetClientFn(client), translations.NullTranslationHelper)

			// Create call request
			request := createMCPRequest(tc.requestArgs)

			// Call handler
			result, err := handler(context.Background(), request)

			// Verify results
			if tc.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.expectedErrMsg)
				return
			}

			require.NoError(t, err)

			// Parse the result and get the text content if no error
			textContent := getTextResult(t, result)
			var returnedRelease github.RepositoryRelease
			err = json.Unmarshal([]byte(textContent.Text), &returnedRelease)
			require.NoError(t, err)
			assert.Equal(t, *tc.expectedResult.TagName, *returnedRelease.TagName)
		})
	}

	// Test missing parameter cases
	testCases := []struct {
		name string
		args map[string]interface{}
		want *mcp.CallToolResult
	}{
		{
			name: "missing tag_name",
			args: map[string]interface{}{
				"owner": "testowner",
				"repo":  "testrepo",
			},
			want: mcp.NewToolResultError("missing required parameter: tag_name"),
		},
		{
			name: "missing owner",
			args: map[string]interface{}{
				"repo":     "testrepo",
				"tag_name": "v1.0.0",
			},
			want: mcp.NewToolResultError("missing required parameter: owner"),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockClient := github.NewClient(nil)
			_, handler := CreateRelease(stubGetClientFn(mockClient), translations.NullTranslationHelper)
			request := createMCPRequest(tc.args)
			got, err := handler(context.Background(), request)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func Test_GetLatestRelease(t *testing.T) {
	// Verify tool definition
	mockClient := github.NewClient(nil)
	tool, _ := GetLatestRelease(stubGetClientFn(mockClient), translations.NullTranslationHelper)

	assert.Equal(t, "get_latest_release", tool.Name)
	assert.NotEmpty(t, tool.Description)
	assert.Contains(t, tool.InputSchema.Properties, "owner")
	assert.Contains(t, tool.InputSchema.Properties, "repo")
	assert.ElementsMatch(t, tool.InputSchema.Required, []string{"owner", "repo"})

	// Setup mock release for success case
	mockRelease := &github.RepositoryRelease{
		ID:      github.Ptr(int64(1)),
		TagName: github.Ptr("v1.0.0"),
		Name:    github.Ptr("Latest Release"),
		Body:    github.Ptr("This is the latest release"),
		Draft:   github.Ptr(false),
	}

	tests := []struct {
		name           string
		mockedClient   *http.Client
		requestArgs    map[string]interface{}
		expectError    bool
		expectedResult *github.RepositoryRelease
		expectedErrMsg string
	}{
		{
			name: "successful get latest release",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.GetReposReleasesLatestByOwnerByRepo,
					mockResponse(t, http.StatusOK, mockRelease),
				),
			),
			requestArgs: map[string]interface{}{
				"owner": "testowner",
				"repo":  "testrepo",
			},
			expectError:    false,
			expectedResult: mockRelease,
		},
		{
			name: "get latest release fails",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.GetReposReleasesLatestByOwnerByRepo,
					http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
						w.WriteHeader(http.StatusNotFound)
						_, _ = w.Write([]byte(`{"message": "Not Found"}`))
					}),
				),
			),
			requestArgs: map[string]interface{}{
				"owner": "testowner",
				"repo":  "testrepo",
			},
			expectError:    true,
			expectedErrMsg: "failed to get latest release",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Setup client with mock
			client := github.NewClient(tc.mockedClient)
			_, handler := GetLatestRelease(stubGetClientFn(client), translations.NullTranslationHelper)

			// Create call request
			request := createMCPRequest(tc.requestArgs)

			// Call handler
			result, err := handler(context.Background(), request)

			// Verify results
			if tc.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.expectedErrMsg)
				return
			}

			require.NoError(t, err)

			// Parse the result and get the text content if no error
			textContent := getTextResult(t, result)
			var returnedRelease github.RepositoryRelease
			err = json.Unmarshal([]byte(textContent.Text), &returnedRelease)
			require.NoError(t, err)
			assert.Equal(t, *tc.expectedResult.TagName, *returnedRelease.TagName)
		})
	}
}

func Test_GetReleaseByTag(t *testing.T) {
	// Verify tool definition
	mockClient := github.NewClient(nil)
	tool, _ := GetReleaseByTag(stubGetClientFn(mockClient), translations.NullTranslationHelper)

	assert.Equal(t, "get_release_by_tag", tool.Name)
	assert.NotEmpty(t, tool.Description)
	assert.Contains(t, tool.InputSchema.Properties, "owner")
	assert.Contains(t, tool.InputSchema.Properties, "repo")
	assert.Contains(t, tool.InputSchema.Properties, "tag")
	assert.ElementsMatch(t, tool.InputSchema.Required, []string{"owner", "repo", "tag"})

	// Setup mock release for success case
	mockRelease := &github.RepositoryRelease{
		ID:      github.Ptr(int64(1)),
		TagName: github.Ptr("v1.0.0"),
		Name:    github.Ptr("Release v1.0.0"),
		Body:    github.Ptr("Release by tag"),
		Draft:   github.Ptr(false),
	}

	tests := []struct {
		name           string
		mockedClient   *http.Client
		requestArgs    map[string]interface{}
		expectError    bool
		expectedResult *github.RepositoryRelease
		expectedErrMsg string
	}{
		{
			name: "successful get release by tag",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.GetReposReleasesTagsByOwnerByRepoByTag,
					mockResponse(t, http.StatusOK, mockRelease),
				),
			),
			requestArgs: map[string]interface{}{
				"owner": "testowner",
				"repo":  "testrepo",
				"tag":   "v1.0.0",
			},
			expectError:    false,
			expectedResult: mockRelease,
		},
		{
			name: "get release by tag fails",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.GetReposReleasesTagsByOwnerByRepoByTag,
					http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
						w.WriteHeader(http.StatusNotFound)
						_, _ = w.Write([]byte(`{"message": "Not Found"}`))
					}),
				),
			),
			requestArgs: map[string]interface{}{
				"owner": "testowner",
				"repo":  "testrepo",
				"tag":   "v2.0.0",
			},
			expectError:    true,
			expectedErrMsg: "failed to get release by tag",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Setup client with mock
			client := github.NewClient(tc.mockedClient)
			_, handler := GetReleaseByTag(stubGetClientFn(client), translations.NullTranslationHelper)

			// Create call request
			request := createMCPRequest(tc.requestArgs)

			// Call handler
			result, err := handler(context.Background(), request)

			// Verify results
			if tc.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.expectedErrMsg)
				return
			}

			require.NoError(t, err)

			// Parse the result and get the text content if no error
			textContent := getTextResult(t, result)
			var returnedRelease github.RepositoryRelease
			err = json.Unmarshal([]byte(textContent.Text), &returnedRelease)
			require.NoError(t, err)
			assert.Equal(t, *tc.expectedResult.TagName, *returnedRelease.TagName)
		})
	}

	// Test missing parameter cases
	testCases := []struct {
		name string
		args map[string]interface{}
		want *mcp.CallToolResult
	}{
		{
			name: "missing tag",
			args: map[string]interface{}{
				"owner": "testowner",
				"repo":  "testrepo",
			},
			want: mcp.NewToolResultError("missing required parameter: tag"),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockClient := github.NewClient(nil)
			_, handler := GetReleaseByTag(stubGetClientFn(mockClient), translations.NullTranslationHelper)
			request := createMCPRequest(tc.args)
			got, err := handler(context.Background(), request)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func Test_GetRelease(t *testing.T) {
	// Verify tool definition
	mockClient := github.NewClient(nil)
	tool, _ := GetRelease(stubGetClientFn(mockClient), translations.NullTranslationHelper)

	assert.Equal(t, "get_release", tool.Name)
	assert.NotEmpty(t, tool.Description)
	assert.Contains(t, tool.InputSchema.Properties, "owner")
	assert.Contains(t, tool.InputSchema.Properties, "repo")
	assert.Contains(t, tool.InputSchema.Properties, "release_id")
	assert.ElementsMatch(t, tool.InputSchema.Required, []string{"owner", "repo", "release_id"})

	// Setup mock release for success case
	mockRelease := &github.RepositoryRelease{
		ID:      github.Ptr(int64(123)),
		TagName: github.Ptr("v1.0.0"),
		Name:    github.Ptr("Release v1.0.0"),
		Body:    github.Ptr("Release by ID"),
		Draft:   github.Ptr(false),
	}

	tests := []struct {
		name           string
		mockedClient   *http.Client
		requestArgs    map[string]interface{}
		expectError    bool
		expectedResult *github.RepositoryRelease
		expectedErrMsg string
	}{
		{
			name: "successful get release",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.GetReposReleasesByOwnerByRepoByReleaseId,
					mockResponse(t, http.StatusOK, mockRelease),
				),
			),
			requestArgs: map[string]interface{}{
				"owner":      "testowner",
				"repo":       "testrepo",
				"release_id": float64(123),
			},
			expectError:    false,
			expectedResult: mockRelease,
		},
		{
			name: "get release fails",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.GetReposReleasesByOwnerByRepoByReleaseId,
					http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
						w.WriteHeader(http.StatusNotFound)
						_, _ = w.Write([]byte(`{"message": "Not Found"}`))
					}),
				),
			),
			requestArgs: map[string]interface{}{
				"owner":      "testowner",
				"repo":       "testrepo",
				"release_id": float64(999),
			},
			expectError:    true,
			expectedErrMsg: "failed to get release",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Setup client with mock
			client := github.NewClient(tc.mockedClient)
			_, handler := GetRelease(stubGetClientFn(client), translations.NullTranslationHelper)

			// Create call request
			request := createMCPRequest(tc.requestArgs)

			// Call handler
			result, err := handler(context.Background(), request)

			// Verify results
			if tc.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.expectedErrMsg)
				return
			}

			require.NoError(t, err)

			// Parse the result and get the text content if no error
			textContent := getTextResult(t, result)
			var returnedRelease github.RepositoryRelease
			err = json.Unmarshal([]byte(textContent.Text), &returnedRelease)
			require.NoError(t, err)
			assert.Equal(t, *tc.expectedResult.ID, *returnedRelease.ID)
		})
	}

	// Test missing parameter cases
	testCases := []struct {
		name string
		args map[string]interface{}
		want *mcp.CallToolResult
	}{
		{
			name: "missing release_id",
			args: map[string]interface{}{
				"owner": "testowner",
				"repo":  "testrepo",
			},
			want: mcp.NewToolResultError("missing required parameter: release_id"),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockClient := github.NewClient(nil)
			_, handler := GetRelease(stubGetClientFn(mockClient), translations.NullTranslationHelper)
			request := createMCPRequest(tc.args)
			got, err := handler(context.Background(), request)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func Test_UpdateRelease(t *testing.T) {
	// Verify tool definition
	mockClient := github.NewClient(nil)
	tool, _ := UpdateRelease(stubGetClientFn(mockClient), translations.NullTranslationHelper)

	assert.Equal(t, "update_release", tool.Name)
	assert.NotEmpty(t, tool.Description)
	assert.Contains(t, tool.InputSchema.Properties, "owner")
	assert.Contains(t, tool.InputSchema.Properties, "repo")
	assert.Contains(t, tool.InputSchema.Properties, "release_id")
	assert.ElementsMatch(t, tool.InputSchema.Required, []string{"owner", "repo", "release_id"})

	// Setup mock release for success case
	mockRelease := &github.RepositoryRelease{
		ID:      github.Ptr(int64(123)),
		TagName: github.Ptr("v1.0.1"),
		Name:    github.Ptr("Updated Release v1.0.1"),
		Body:    github.Ptr("Updated release body"),
		Draft:   github.Ptr(false),
	}

	tests := []struct {
		name           string
		mockedClient   *http.Client
		requestArgs    map[string]interface{}
		expectError    bool
		expectedResult *github.RepositoryRelease
		expectedErrMsg string
	}{
		{
			name: "successful update release",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.PatchReposReleasesByOwnerByRepoByReleaseId,
					mockResponse(t, http.StatusOK, mockRelease),
				),
			),
			requestArgs: map[string]interface{}{
				"owner":      "testowner",
				"repo":       "testrepo",
				"release_id": float64(123),
				"name":       "Updated Release v1.0.1",
				"body":       "Updated release body",
			},
			expectError:    false,
			expectedResult: mockRelease,
		},
		{
			name: "update release fails",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.PatchReposReleasesByOwnerByRepoByReleaseId,
					http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
						w.WriteHeader(http.StatusNotFound)
						_, _ = w.Write([]byte(`{"message": "Not Found"}`))
					}),
				),
			),
			requestArgs: map[string]interface{}{
				"owner":      "testowner",
				"repo":       "testrepo",
				"release_id": float64(999),
			},
			expectError:    true,
			expectedErrMsg: "failed to update release",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Setup client with mock
			client := github.NewClient(tc.mockedClient)
			_, handler := UpdateRelease(stubGetClientFn(client), translations.NullTranslationHelper)

			// Create call request
			request := createMCPRequest(tc.requestArgs)

			// Call handler
			result, err := handler(context.Background(), request)

			// Verify results
			if tc.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.expectedErrMsg)
				return
			}

			require.NoError(t, err)

			// Parse the result and get the text content if no error
			textContent := getTextResult(t, result)
			var returnedRelease github.RepositoryRelease
			err = json.Unmarshal([]byte(textContent.Text), &returnedRelease)
			require.NoError(t, err)
			assert.Equal(t, *tc.expectedResult.Name, *returnedRelease.Name)
		})
	}
}

func Test_DeleteRelease(t *testing.T) {
	// Verify tool definition
	mockClient := github.NewClient(nil)
	tool, _ := DeleteRelease(stubGetClientFn(mockClient), translations.NullTranslationHelper)

	assert.Equal(t, "delete_release", tool.Name)
	assert.NotEmpty(t, tool.Description)
	assert.Contains(t, tool.InputSchema.Properties, "owner")
	assert.Contains(t, tool.InputSchema.Properties, "repo")
	assert.Contains(t, tool.InputSchema.Properties, "release_id")
	assert.ElementsMatch(t, tool.InputSchema.Required, []string{"owner", "repo", "release_id"})

	tests := []struct {
		name           string
		mockedClient   *http.Client
		requestArgs    map[string]interface{}
		expectError    bool
		expectedErrMsg string
	}{
		{
			name: "successful delete release",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.DeleteReposReleasesByOwnerByRepoByReleaseId,
					http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
						w.WriteHeader(http.StatusNoContent)
					}),
				),
			),
			requestArgs: map[string]interface{}{
				"owner":      "testowner",
				"repo":       "testrepo",
				"release_id": float64(123),
			},
			expectError: false,
		},
		{
			name: "delete release fails",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.DeleteReposReleasesByOwnerByRepoByReleaseId,
					http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
						w.WriteHeader(http.StatusNotFound)
						_, _ = w.Write([]byte(`{"message": "Not Found"}`))
					}),
				),
			),
			requestArgs: map[string]interface{}{
				"owner":      "testowner",
				"repo":       "testrepo",
				"release_id": float64(999),
			},
			expectError:    true,
			expectedErrMsg: "failed to delete release",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Setup client with mock
			client := github.NewClient(tc.mockedClient)
			_, handler := DeleteRelease(stubGetClientFn(client), translations.NullTranslationHelper)

			// Create call request
			request := createMCPRequest(tc.requestArgs)

			// Call handler
			result, err := handler(context.Background(), request)

			// Verify results
			if tc.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.expectedErrMsg)
				return
			}

			require.NoError(t, err)

			// Parse the result and get the text content if no error
			textContent := getTextResult(t, result)
			assert.Contains(t, textContent.Text, "Release deleted successfully")
		})
	}
}

func Test_GenerateReleaseNotes(t *testing.T) {
	// Verify tool definition
	mockClient := github.NewClient(nil)
	tool, _ := GenerateReleaseNotes(stubGetClientFn(mockClient), translations.NullTranslationHelper)

	assert.Equal(t, "generate_release_notes", tool.Name)
	assert.NotEmpty(t, tool.Description)
	assert.Contains(t, tool.InputSchema.Properties, "owner")
	assert.Contains(t, tool.InputSchema.Properties, "repo")
	assert.Contains(t, tool.InputSchema.Properties, "tag_name")
	assert.ElementsMatch(t, tool.InputSchema.Required, []string{"owner", "repo", "tag_name"})

	// Setup mock release notes for success case
	mockReleaseNotes := &github.RepositoryReleaseNotes{
		Name: "Generated Release v1.0.0",
		Body: "## What's Changed\n* Feature A by @user in #123\n* Bug fix B by @user2 in #124",
	}

	tests := []struct {
		name           string
		mockedClient   *http.Client
		requestArgs    map[string]interface{}
		expectError    bool
		expectedResult *github.RepositoryReleaseNotes
		expectedErrMsg string
	}{
		{
			name: "successful generate release notes",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.PostReposReleasesGenerateNotesByOwnerByRepo,
					mockResponse(t, http.StatusOK, mockReleaseNotes),
				),
			),
			requestArgs: map[string]interface{}{
				"owner":    "testowner",
				"repo":     "testrepo",
				"tag_name": "v1.0.0",
			},
			expectError:    false,
			expectedResult: mockReleaseNotes,
		},
		{
			name: "generate release notes fails",
			mockedClient: mock.NewMockedHTTPClient(
				mock.WithRequestMatchHandler(
					mock.PostReposReleasesGenerateNotesByOwnerByRepo,
					http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
						w.WriteHeader(http.StatusUnprocessableEntity)
						_, _ = w.Write([]byte(`{"message": "Validation Failed"}`))
					}),
				),
			),
			requestArgs: map[string]interface{}{
				"owner":    "testowner",
				"repo":     "testrepo",
				"tag_name": "invalid-tag",
			},
			expectError:    true,
			expectedErrMsg: "failed to generate release notes",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Setup client with mock
			client := github.NewClient(tc.mockedClient)
			_, handler := GenerateReleaseNotes(stubGetClientFn(client), translations.NullTranslationHelper)

			// Create call request
			request := createMCPRequest(tc.requestArgs)

			// Call handler
			result, err := handler(context.Background(), request)

			// Verify results
			if tc.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.expectedErrMsg)
				return
			}

			require.NoError(t, err)

			// Parse the result and get the text content if no error
			textContent := getTextResult(t, result)
			var returnedNotes github.RepositoryReleaseNotes
			err = json.Unmarshal([]byte(textContent.Text), &returnedNotes)
			require.NoError(t, err)
			assert.Equal(t, tc.expectedResult.Name, returnedNotes.Name)
			assert.Equal(t, tc.expectedResult.Body, returnedNotes.Body)
		})
	}

	// Test missing parameter cases
	testCases := []struct {
		name string
		args map[string]interface{}
		want *mcp.CallToolResult
	}{
		{
			name: "missing tag_name",
			args: map[string]interface{}{
				"owner": "testowner",
				"repo":  "testrepo",
			},
			want: mcp.NewToolResultError("missing required parameter: tag_name"),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockClient := github.NewClient(nil)
			_, handler := GenerateReleaseNotes(stubGetClientFn(mockClient), translations.NullTranslationHelper)
			request := createMCPRequest(tc.args)
			got, err := handler(context.Background(), request)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}
