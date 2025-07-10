package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/github/github-mcp-server/pkg/translations"
	"github.com/google/go-github/v72/github"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// CleanedCodeSearchResult represents a cleaned version of CodeSearchResult without URL fields
type CleanedCodeSearchResult struct {
	Total             *int                 `json:"total_count,omitempty"`
	IncompleteResults *bool                `json:"incomplete_results,omitempty"`
	CodeResults       []*CleanedCodeResult `json:"items,omitempty"`
}

// CleanedCodeResult represents a cleaned version of CodeResult without URL fields
type CleanedCodeResult struct {
	Name        *string             `json:"name,omitempty"`
	Path        *string             `json:"path,omitempty"`
	SHA         *string             `json:"sha,omitempty"`
	Repository  *CleanedRepository  `json:"repository,omitempty"`
	TextMatches []*CleanedTextMatch `json:"text_matches,omitempty"`
}

// CleanedTextMatch represents a cleaned version of TextMatch without URL fields
type CleanedTextMatch struct {
	ObjectType *string         `json:"object_type,omitempty"`
	Property   *string         `json:"property,omitempty"`
	Fragment   *string         `json:"fragment,omitempty"`
	Matches    []*github.Match `json:"matches,omitempty"`
}

// cleanCodeSearchResult removes URL fields from CodeSearchResult
func cleanCodeSearchResult(result *github.CodeSearchResult) *CleanedCodeSearchResult {
	if result == nil {
		return nil
	}

	cleaned := &CleanedCodeSearchResult{
		Total:             result.Total,
		IncompleteResults: result.IncompleteResults,
	}

	if result.CodeResults != nil {
		cleaned.CodeResults = make([]*CleanedCodeResult, len(result.CodeResults))
		for i, codeResult := range result.CodeResults {
			cleaned.CodeResults[i] = cleanCodeResult(codeResult)
		}
	}

	return cleaned
}

// cleanCodeResult removes URL fields from CodeResult
func cleanCodeResult(result *github.CodeResult) *CleanedCodeResult {
	if result == nil {
		return nil
	}

	cleaned := &CleanedCodeResult{
		Name: result.Name,
		Path: result.Path,
		SHA:  result.SHA,
	}

	if result.Repository != nil {
		cleaned.Repository = cleanRepositoryForSearch(result.Repository)
	}

	if result.TextMatches != nil {
		cleaned.TextMatches = make([]*CleanedTextMatch, len(result.TextMatches))
		for i, textMatch := range result.TextMatches {
			cleaned.TextMatches[i] = cleanTextMatch(textMatch)
		}
	}

	return cleaned
}

// cleanTextMatch removes URL fields from TextMatch
func cleanTextMatch(textMatch *github.TextMatch) *CleanedTextMatch {
	if textMatch == nil {
		return nil
	}

	cleaned := &CleanedTextMatch{
		ObjectType: textMatch.ObjectType,
		Property:   textMatch.Property,
		Fragment:   textMatch.Fragment,
	}

	if textMatch.Matches != nil {
		cleaned.Matches = textMatch.Matches
	}

	return cleaned
}

// SearchRepositories creates a tool to search for GitHub repositories.
func SearchRepositories(getClient GetClientFn, t translations.TranslationHelperFunc) (tool mcp.Tool, handler server.ToolHandlerFunc) {
	return mcp.NewTool("search_repositories",
			mcp.WithDescription(t("TOOL_SEARCH_REPOSITORIES_DESCRIPTION", "Search for GitHub repositories")),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:        t("TOOL_SEARCH_REPOSITORIES_USER_TITLE", "Search repositories"),
				ReadOnlyHint: toBoolPtr(true),
			}),
			mcp.WithString("query",
				mcp.Required(),
				mcp.Description("Search query"),
			),
			WithPagination(),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			query, err := requiredParam[string](request, "query")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			pagination, err := OptionalPaginationParams(request)
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			opts := &github.SearchOptions{
				ListOptions: github.ListOptions{
					Page:    pagination.page,
					PerPage: pagination.perPage,
				},
			}

			client, err := getClient(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to get GitHub client: %w", err)
			}
			result, resp, err := client.Search.Repositories(ctx, query, opts)
			if err != nil {
				return nil, fmt.Errorf("failed to search repositories: %w", err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != 200 {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return nil, fmt.Errorf("failed to read response body: %w", err)
				}
				return mcp.NewToolResultError(fmt.Sprintf("failed to search repositories: %s", string(body))), nil
			}

			r, err := json.Marshal(result)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal response: %w", err)
			}

			return mcp.NewToolResultText(string(r)), nil
		}
}

// SearchCode creates a tool to search for code across GitHub repositories.
func SearchCode(getClient GetClientFn, t translations.TranslationHelperFunc) (tool mcp.Tool, handler server.ToolHandlerFunc) {
	return mcp.NewTool("search_code",
			mcp.WithDescription(t("TOOL_SEARCH_CODE_DESCRIPTION", "Search for code across GitHub repositories")),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:        t("TOOL_SEARCH_CODE_USER_TITLE", "Search code"),
				ReadOnlyHint: toBoolPtr(true),
			}),
			mcp.WithString("q",
				mcp.Required(),
				mcp.Description("Search query using GitHub code search syntax"),
			),
			mcp.WithString("sort",
				mcp.Description("Sort field ('indexed' only)"),
			),
			mcp.WithString("order",
				mcp.Description("Sort order"),
				mcp.Enum("asc", "desc"),
			),
			WithPagination(),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			query, err := requiredParam[string](request, "q")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			sort, err := OptionalParam[string](request, "sort")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			order, err := OptionalParam[string](request, "order")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			pagination, err := OptionalPaginationParams(request)
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			opts := &github.SearchOptions{
				Sort:  sort,
				Order: order,
				ListOptions: github.ListOptions{
					PerPage: pagination.perPage,
					Page:    pagination.page,
				},
			}

			client, err := getClient(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to get GitHub client: %w", err)
			}

			result, resp, err := client.Search.Code(ctx, query, opts)
			if err != nil {
				return nil, fmt.Errorf("failed to search code: %w", err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != 200 {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return nil, fmt.Errorf("failed to read response body: %w", err)
				}
				return mcp.NewToolResultError(fmt.Sprintf("failed to search code: %s", string(body))), nil
			}

			cleanedResult := cleanCodeSearchResult(result)

			r, err := json.Marshal(cleanedResult)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal response: %w", err)
			}

			return mcp.NewToolResultText(string(r)), nil
		}
}

type MinimalUser struct {
	Login      string `json:"login"`
	ID         int64  `json:"id,omitempty"`
	ProfileURL string `json:"profile_url,omitempty"`
	AvatarURL  string `json:"avatar_url,omitempty"`
}

type MinimalSearchUsersResult struct {
	TotalCount        int           `json:"total_count"`
	IncompleteResults bool          `json:"incomplete_results"`
	Items             []MinimalUser `json:"items"`
}

// SearchUsers creates a tool to search for GitHub users.
func SearchUsers(getClient GetClientFn, t translations.TranslationHelperFunc) (tool mcp.Tool, handler server.ToolHandlerFunc) {
	return mcp.NewTool("search_users",
			mcp.WithDescription(t("TOOL_SEARCH_USERS_DESCRIPTION", "Search for GitHub users")),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:        t("TOOL_SEARCH_USERS_USER_TITLE", "Search users"),
				ReadOnlyHint: toBoolPtr(true),
			}),
			mcp.WithString("q",
				mcp.Required(),
				mcp.Description("Search query using GitHub users search syntax"),
			),
			mcp.WithString("sort",
				mcp.Description("Sort field by category"),
				mcp.Enum("followers", "repositories", "joined"),
			),
			mcp.WithString("order",
				mcp.Description("Sort order"),
				mcp.Enum("asc", "desc"),
			),
			WithPagination(),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			query, err := requiredParam[string](request, "q")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			sort, err := OptionalParam[string](request, "sort")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			order, err := OptionalParam[string](request, "order")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			pagination, err := OptionalPaginationParams(request)
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			opts := &github.SearchOptions{
				Sort:  sort,
				Order: order,
				ListOptions: github.ListOptions{
					PerPage: pagination.perPage,
					Page:    pagination.page,
				},
			}

			client, err := getClient(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to get GitHub client: %w", err)
			}

			result, resp, err := client.Search.Users(ctx, "type:user "+query, opts)
			if err != nil {
				return nil, fmt.Errorf("failed to search users: %w", err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != 200 {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return nil, fmt.Errorf("failed to read response body: %w", err)
				}
				return mcp.NewToolResultError(fmt.Sprintf("failed to search users: %s", string(body))), nil
			}

			minimalUsers := make([]MinimalUser, 0, len(result.Users))
			for _, user := range result.Users {
				mu := MinimalUser{
					Login:      user.GetLogin(),
					ID:         user.GetID(),
					ProfileURL: user.GetHTMLURL(),
					AvatarURL:  user.GetAvatarURL(),
				}

				minimalUsers = append(minimalUsers, mu)
			}

			minimalResp := MinimalSearchUsersResult{
				TotalCount:        result.GetTotal(),
				IncompleteResults: result.GetIncompleteResults(),
				Items:             minimalUsers,
			}

			r, err := json.Marshal(minimalResp)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal response: %w", err)
			}
			return mcp.NewToolResultText(string(r)), nil
		}
}
