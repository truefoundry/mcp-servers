package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/github/github-mcp-server/pkg/translations"
	"github.com/google/go-github/v72/github"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// ListReleases creates a tool to list releases for a repository.
func ListReleases(getClient GetClientFn, t translations.TranslationHelperFunc) (tool mcp.Tool, handler server.ToolHandlerFunc) {
	return mcp.NewTool("list_releases",
			mcp.WithDescription(t("TOOL_LIST_RELEASES_DESCRIPTION", "List releases for a GitHub repository.")),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:        t("TOOL_LIST_RELEASES_USER_TITLE", "List releases"),
				ReadOnlyHint: toBoolPtr(true),
			}),
			mcp.WithString("owner",
				mcp.Required(),
				mcp.Description("Repository owner"),
			),
			mcp.WithString("repo",
				mcp.Required(),
				mcp.Description("Repository name"),
			),
			WithPagination(),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			owner, err := requiredParam[string](request, "owner")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			repo, err := requiredParam[string](request, "repo")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			pagination, err := OptionalPaginationParams(request)
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			opts := &github.ListOptions{
				Page:    pagination.page,
				PerPage: pagination.perPage,
			}

			client, err := getClient(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to get GitHub client: %w", err)
			}

			releases, resp, err := client.Repositories.ListReleases(ctx, owner, repo, opts)
			if err != nil {
				return nil, fmt.Errorf("failed to list releases: %w", err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != http.StatusOK {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return nil, fmt.Errorf("failed to read response body: %w", err)
				}
				return mcp.NewToolResultError(fmt.Sprintf("failed to list releases: %s", string(body))), nil
			}

			r, err := json.Marshal(releases)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal releases: %w", err)
			}

			return mcp.NewToolResultText(string(r)), nil
		}
}

// CreateRelease creates a tool to create a new release.
func CreateRelease(getClient GetClientFn, t translations.TranslationHelperFunc) (tool mcp.Tool, handler server.ToolHandlerFunc) {
	return mcp.NewTool("create_release",
			mcp.WithDescription(t("TOOL_CREATE_RELEASE_DESCRIPTION", "Create a new release in a GitHub repository.")),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:        t("TOOL_CREATE_RELEASE_USER_TITLE", "Create release"),
				ReadOnlyHint: toBoolPtr(false),
			}),
			mcp.WithString("owner",
				mcp.Required(),
				mcp.Description("Repository owner"),
			),
			mcp.WithString("repo",
				mcp.Required(),
				mcp.Description("Repository name"),
			),
			mcp.WithString("tag_name",
				mcp.Required(),
				mcp.Description("The name of the tag"),
			),
			mcp.WithString("target_commitish",
				mcp.Description("Specifies the commitish value that determines where the Git tag is created from"),
			),
			mcp.WithString("name",
				mcp.Description("The name of the release"),
			),
			mcp.WithString("body",
				mcp.Description("Text describing the contents of the tag"),
			),
			mcp.WithBoolean("draft",
				mcp.Description("true to create a draft (unpublished) release, false to create a published one"),
			),
			mcp.WithBoolean("prerelease",
				mcp.Description("true to identify the release as a prerelease, false to identify the release as a full release"),
			),
			mcp.WithString("discussion_category_name",
				mcp.Description("If specified, a discussion of the specified category is created and linked to the release"),
			),
			mcp.WithBoolean("generate_release_notes",
				mcp.Description("Whether to automatically generate the name and body for this release"),
			),
			mcp.WithString("make_latest",
				mcp.Description("Specifies whether this release should be set as the latest release for the repository"),
				mcp.Enum("true", "false", "legacy"),
			),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			owner, err := requiredParam[string](request, "owner")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			repo, err := requiredParam[string](request, "repo")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			tagName, err := requiredParam[string](request, "tag_name")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			// Optional parameters
			targetCommitish, err := OptionalParam[string](request, "target_commitish")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			name, err := OptionalParam[string](request, "name")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			body, err := OptionalParam[string](request, "body")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			draft, err := OptionalParam[bool](request, "draft")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			prerelease, err := OptionalParam[bool](request, "prerelease")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			discussionCategoryName, err := OptionalParam[string](request, "discussion_category_name")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			generateReleaseNotes, err := OptionalParam[bool](request, "generate_release_notes")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			makeLatest, err := OptionalParam[string](request, "make_latest")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

					// Create the release request
		releaseRequest := &github.RepositoryRelease{
			TagName: github.Ptr(tagName),
		}

		// Only set optional fields if they're not empty
		if targetCommitish != "" {
			releaseRequest.TargetCommitish = github.Ptr(targetCommitish)
		}
		if name != "" {
			releaseRequest.Name = github.Ptr(name)
		}
		if body != "" {
			releaseRequest.Body = github.Ptr(body)
		}
		if request.GetArguments()["draft"] != nil {
			releaseRequest.Draft = github.Ptr(draft)
		}
		if request.GetArguments()["prerelease"] != nil {
			releaseRequest.Prerelease = github.Ptr(prerelease)
		}
		if discussionCategoryName != "" {
			releaseRequest.DiscussionCategoryName = github.Ptr(discussionCategoryName)
		}
		if request.GetArguments()["generate_release_notes"] != nil {
			releaseRequest.GenerateReleaseNotes = github.Ptr(generateReleaseNotes)
		}
		if makeLatest != "" {
			releaseRequest.MakeLatest = github.Ptr(makeLatest)
		}

			client, err := getClient(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to get GitHub client: %w", err)
			}

			release, resp, err := client.Repositories.CreateRelease(ctx, owner, repo, releaseRequest)
			if err != nil {
				return nil, fmt.Errorf("failed to create release: %w", err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != http.StatusCreated {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return nil, fmt.Errorf("failed to read response body: %w", err)
				}
				return mcp.NewToolResultError(fmt.Sprintf("failed to create release: %s", string(body))), nil
			}

			r, err := json.Marshal(release)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal response: %w", err)
			}

			return mcp.NewToolResultText(string(r)), nil
		}
}

// GetLatestRelease creates a tool to get the latest published full release for the repository.
func GetLatestRelease(getClient GetClientFn, t translations.TranslationHelperFunc) (tool mcp.Tool, handler server.ToolHandlerFunc) {
	return mcp.NewTool("get_latest_release",
			mcp.WithDescription(t("TOOL_GET_LATEST_RELEASE_DESCRIPTION", "Get the latest published full release for the repository.")),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:        t("TOOL_GET_LATEST_RELEASE_USER_TITLE", "Get latest release"),
				ReadOnlyHint: toBoolPtr(true),
			}),
			mcp.WithString("owner",
				mcp.Required(),
				mcp.Description("Repository owner"),
			),
			mcp.WithString("repo",
				mcp.Required(),
				mcp.Description("Repository name"),
			),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			owner, err := requiredParam[string](request, "owner")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			repo, err := requiredParam[string](request, "repo")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			client, err := getClient(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to get GitHub client: %w", err)
			}

			release, resp, err := client.Repositories.GetLatestRelease(ctx, owner, repo)
			if err != nil {
				return nil, fmt.Errorf("failed to get latest release: %w", err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != http.StatusOK {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return nil, fmt.Errorf("failed to read response body: %w", err)
				}
				return mcp.NewToolResultError(fmt.Sprintf("failed to get latest release: %s", string(body))), nil
			}

			r, err := json.Marshal(release)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal response: %w", err)
			}

			return mcp.NewToolResultText(string(r)), nil
		}
}

// GetReleaseByTag creates a tool to get a published release with the specified tag.
func GetReleaseByTag(getClient GetClientFn, t translations.TranslationHelperFunc) (tool mcp.Tool, handler server.ToolHandlerFunc) {
	return mcp.NewTool("get_release_by_tag",
			mcp.WithDescription(t("TOOL_GET_RELEASE_BY_TAG_DESCRIPTION", "Get a published release with the specified tag.")),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:        t("TOOL_GET_RELEASE_BY_TAG_USER_TITLE", "Get release by tag"),
				ReadOnlyHint: toBoolPtr(true),
			}),
			mcp.WithString("owner",
				mcp.Required(),
				mcp.Description("Repository owner"),
			),
			mcp.WithString("repo",
				mcp.Required(),
				mcp.Description("Repository name"),
			),
			mcp.WithString("tag",
				mcp.Required(),
				mcp.Description("Tag name"),
			),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			owner, err := requiredParam[string](request, "owner")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			repo, err := requiredParam[string](request, "repo")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			tag, err := requiredParam[string](request, "tag")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			client, err := getClient(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to get GitHub client: %w", err)
			}

			release, resp, err := client.Repositories.GetReleaseByTag(ctx, owner, repo, tag)
			if err != nil {
				return nil, fmt.Errorf("failed to get release by tag: %w", err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != http.StatusOK {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return nil, fmt.Errorf("failed to read response body: %w", err)
				}
				return mcp.NewToolResultError(fmt.Sprintf("failed to get release by tag: %s", string(body))), nil
			}

			r, err := json.Marshal(release)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal response: %w", err)
			}

			return mcp.NewToolResultText(string(r)), nil
		}
}

// GetRelease creates a tool to get a specific release.
func GetRelease(getClient GetClientFn, t translations.TranslationHelperFunc) (tool mcp.Tool, handler server.ToolHandlerFunc) {
	return mcp.NewTool("get_release",
			mcp.WithDescription(t("TOOL_GET_RELEASE_DESCRIPTION", "Get a specific release by its ID.")),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:        t("TOOL_GET_RELEASE_USER_TITLE", "Get release"),
				ReadOnlyHint: toBoolPtr(true),
			}),
			mcp.WithString("owner",
				mcp.Required(),
				mcp.Description("Repository owner"),
			),
			mcp.WithString("repo",
				mcp.Required(),
				mcp.Description("Repository name"),
			),
			mcp.WithNumber("release_id",
				mcp.Required(),
				mcp.Description("The unique identifier of the release"),
			),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			owner, err := requiredParam[string](request, "owner")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			repo, err := requiredParam[string](request, "repo")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			releaseID, err := requiredParam[float64](request, "release_id")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			client, err := getClient(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to get GitHub client: %w", err)
			}

			release, resp, err := client.Repositories.GetRelease(ctx, owner, repo, int64(releaseID))
			if err != nil {
				return nil, fmt.Errorf("failed to get release: %w", err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != http.StatusOK {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return nil, fmt.Errorf("failed to read response body: %w", err)
				}
				return mcp.NewToolResultError(fmt.Sprintf("failed to get release: %s", string(body))), nil
			}

			r, err := json.Marshal(release)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal response: %w", err)
			}

			return mcp.NewToolResultText(string(r)), nil
		}
}

// UpdateRelease creates a tool to update a release.
func UpdateRelease(getClient GetClientFn, t translations.TranslationHelperFunc) (tool mcp.Tool, handler server.ToolHandlerFunc) {
	return mcp.NewTool("update_release",
			mcp.WithDescription(t("TOOL_UPDATE_RELEASE_DESCRIPTION", "Update an existing release in a GitHub repository.")),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:        t("TOOL_UPDATE_RELEASE_USER_TITLE", "Update release"),
				ReadOnlyHint: toBoolPtr(false),
			}),
			mcp.WithString("owner",
				mcp.Required(),
				mcp.Description("Repository owner"),
			),
			mcp.WithString("repo",
				mcp.Required(),
				mcp.Description("Repository name"),
			),
			mcp.WithNumber("release_id",
				mcp.Required(),
				mcp.Description("The unique identifier of the release"),
			),
			mcp.WithString("tag_name",
				mcp.Description("The name of the tag"),
			),
			mcp.WithString("target_commitish",
				mcp.Description("Specifies the commitish value that determines where the Git tag is created from"),
			),
			mcp.WithString("name",
				mcp.Description("The name of the release"),
			),
			mcp.WithString("body",
				mcp.Description("Text describing the contents of the tag"),
			),
			mcp.WithBoolean("draft",
				mcp.Description("true makes the release a draft, and false publishes the release"),
			),
			mcp.WithBoolean("prerelease",
				mcp.Description("true to identify the release as a prerelease, false to identify the release as a full release"),
			),
			mcp.WithString("discussion_category_name",
				mcp.Description("If specified, a discussion of the specified category is created and linked to the release"),
			),
			mcp.WithString("make_latest",
				mcp.Description("Specifies whether this release should be set as the latest release for the repository"),
				mcp.Enum("true", "false", "legacy"),
			),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			owner, err := requiredParam[string](request, "owner")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			repo, err := requiredParam[string](request, "repo")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			releaseID, err := requiredParam[float64](request, "release_id")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			// Optional parameters
			tagName, err := OptionalParam[string](request, "tag_name")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			targetCommitish, err := OptionalParam[string](request, "target_commitish")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			name, err := OptionalParam[string](request, "name")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			body, err := OptionalParam[string](request, "body")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			draft, err := OptionalParam[bool](request, "draft")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			prerelease, err := OptionalParam[bool](request, "prerelease")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			discussionCategoryName, err := OptionalParam[string](request, "discussion_category_name")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			makeLatest, err := OptionalParam[string](request, "make_latest")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			// Create the release request
			releaseRequest := &github.RepositoryRelease{}
			if tagName != "" {
				releaseRequest.TagName = github.Ptr(tagName)
			}
			if targetCommitish != "" {
				releaseRequest.TargetCommitish = github.Ptr(targetCommitish)
			}
			if name != "" {
				releaseRequest.Name = github.Ptr(name)
			}
			if body != "" {
				releaseRequest.Body = github.Ptr(body)
			}
			if request.GetArguments()["draft"] != nil {
				releaseRequest.Draft = github.Ptr(draft)
			}
			if request.GetArguments()["prerelease"] != nil {
				releaseRequest.Prerelease = github.Ptr(prerelease)
			}
			if discussionCategoryName != "" {
				releaseRequest.DiscussionCategoryName = github.Ptr(discussionCategoryName)
			}
			if makeLatest != "" {
				releaseRequest.MakeLatest = github.Ptr(makeLatest)
			}

			client, err := getClient(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to get GitHub client: %w", err)
			}

			release, resp, err := client.Repositories.EditRelease(ctx, owner, repo, int64(releaseID), releaseRequest)
			if err != nil {
				return nil, fmt.Errorf("failed to update release: %w", err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != http.StatusOK {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return nil, fmt.Errorf("failed to read response body: %w", err)
				}
				return mcp.NewToolResultError(fmt.Sprintf("failed to update release: %s", string(body))), nil
			}

			r, err := json.Marshal(release)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal response: %w", err)
			}

			return mcp.NewToolResultText(string(r)), nil
		}
}

// DeleteRelease creates a tool to delete a release.
func DeleteRelease(getClient GetClientFn, t translations.TranslationHelperFunc) (tool mcp.Tool, handler server.ToolHandlerFunc) {
	return mcp.NewTool("delete_release",
			mcp.WithDescription(t("TOOL_DELETE_RELEASE_DESCRIPTION", "Delete a release from a GitHub repository.")),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:        t("TOOL_DELETE_RELEASE_USER_TITLE", "Delete release"),
				ReadOnlyHint: toBoolPtr(false),
			}),
			mcp.WithString("owner",
				mcp.Required(),
				mcp.Description("Repository owner"),
			),
			mcp.WithString("repo",
				mcp.Required(),
				mcp.Description("Repository name"),
			),
			mcp.WithNumber("release_id",
				mcp.Required(),
				mcp.Description("The unique identifier of the release"),
			),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			owner, err := requiredParam[string](request, "owner")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			repo, err := requiredParam[string](request, "repo")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			releaseID, err := requiredParam[float64](request, "release_id")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			client, err := getClient(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to get GitHub client: %w", err)
			}

			resp, err := client.Repositories.DeleteRelease(ctx, owner, repo, int64(releaseID))
			if err != nil {
				return nil, fmt.Errorf("failed to delete release: %w", err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != http.StatusNoContent {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return nil, fmt.Errorf("failed to read response body: %w", err)
				}
				return mcp.NewToolResultError(fmt.Sprintf("failed to delete release: %s", string(body))), nil
			}

			return mcp.NewToolResultText("Release deleted successfully"), nil
		}
}

// GenerateReleaseNotes creates a tool to generate release notes content for a release.
func GenerateReleaseNotes(getClient GetClientFn, t translations.TranslationHelperFunc) (tool mcp.Tool, handler server.ToolHandlerFunc) {
	return mcp.NewTool("generate_release_notes",
			mcp.WithDescription(t("TOOL_GENERATE_RELEASE_NOTES_DESCRIPTION", "Generate release notes content for a release.")),
			mcp.WithToolAnnotation(mcp.ToolAnnotation{
				Title:        t("TOOL_GENERATE_RELEASE_NOTES_USER_TITLE", "Generate release notes"),
				ReadOnlyHint: toBoolPtr(true),
			}),
			mcp.WithString("owner",
				mcp.Required(),
				mcp.Description("Repository owner"),
			),
			mcp.WithString("repo",
				mcp.Required(),
				mcp.Description("Repository name"),
			),
			mcp.WithString("tag_name",
				mcp.Required(),
				mcp.Description("The tag name for the release"),
			),
			mcp.WithString("target_commitish",
				mcp.Description("Specifies the commitish value that will be the target for the release's tag"),
			),
			mcp.WithString("previous_tag_name",
				mcp.Description("The name of the previous tag to use as the starting point for the release notes"),
			),
		),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			owner, err := requiredParam[string](request, "owner")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			repo, err := requiredParam[string](request, "repo")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			tagName, err := requiredParam[string](request, "tag_name")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			// Optional parameters
			targetCommitish, err := OptionalParam[string](request, "target_commitish")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			previousTagName, err := OptionalParam[string](request, "previous_tag_name")
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}

			// Create the generate release notes request
			opts := &github.GenerateNotesOptions{
				TagName: tagName,
			}

			// Only set optional fields if they're not empty
			if targetCommitish != "" {
				opts.TargetCommitish = github.Ptr(targetCommitish)
			}
			if previousTagName != "" {
				opts.PreviousTagName = github.Ptr(previousTagName)
			}

			client, err := getClient(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to get GitHub client: %w", err)
			}

			releaseNotes, resp, err := client.Repositories.GenerateReleaseNotes(ctx, owner, repo, opts)
			if err != nil {
				return nil, fmt.Errorf("failed to generate release notes: %w", err)
			}
			defer func() { _ = resp.Body.Close() }()

			if resp.StatusCode != http.StatusOK {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return nil, fmt.Errorf("failed to read response body: %w", err)
				}
				return mcp.NewToolResultError(fmt.Sprintf("failed to generate release notes: %s", string(body))), nil
			}

			r, err := json.Marshal(releaseNotes)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal response: %w", err)
			}

			return mcp.NewToolResultText(string(r)), nil
		}
}