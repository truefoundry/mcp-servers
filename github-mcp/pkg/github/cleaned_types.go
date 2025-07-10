package github

import (
	"github.com/google/go-github/v72/github"
)

// CleanedRepositoryContent represents a cleaned version of RepositoryContent without URL fields
type CleanedRepositoryContent struct {
	Type     *string `json:"type,omitempty"`
	Target   *string `json:"target,omitempty"`
	Encoding *string `json:"encoding,omitempty"`
	Size     *int    `json:"size,omitempty"`
	Name     *string `json:"name,omitempty"`
	Path     *string `json:"path,omitempty"`
	Content  *string `json:"content,omitempty"`
	SHA      *string `json:"sha,omitempty"`
}

// CleanedRepository represents a cleaned version of Repository keeping only html_url
type CleanedRepository struct {
	ID       *int64       `json:"id,omitempty"`
	Name     *string      `json:"name,omitempty"`
	FullName *string      `json:"full_name,omitempty"`
	Owner    *CleanedUser `json:"owner,omitempty"`
	Private  *bool        `json:"private,omitempty"`
	Fork     *bool        `json:"fork,omitempty"`
	HTMLURL  *string      `json:"html_url,omitempty"`
}

// CleanedUser represents a cleaned version of User without URL fields
type CleanedUser struct {
	Login *string `json:"login,omitempty"`
	ID    *int64  `json:"id,omitempty"`
	Type  *string `json:"type,omitempty"`
}

// cleanRepositoryContent removes URL fields and uses GetContent() for decoding
func cleanRepositoryContent(content *github.RepositoryContent) (*CleanedRepositoryContent, error) {
	if content == nil {
		return nil, nil
	}

	cleaned := &CleanedRepositoryContent{
		Type:   content.Type,
		Target: content.Target,
		Size:   content.Size,
		Name:   content.Name,
		Path:   content.Path,
		SHA:    content.SHA,
	}

	// Use the existing GetContent() method to handle decoding
	if content.Content != nil {
		decodedContent, err := content.GetContent()
		if err != nil {
			// If GetContent fails (e.g., for binary files or large files),
			// return the original content and encoding
			cleaned.Content = content.Content
			cleaned.Encoding = content.Encoding
		} else {
			// GetContent succeeded, return the decoded content as text
			cleaned.Content = &decodedContent
			cleaned.Encoding = github.Ptr("text")
		}
	}

	return cleaned, nil
}

// cleanRepositoryContentSlice cleans a slice of RepositoryContent
func cleanRepositoryContentSlice(contents []*github.RepositoryContent) ([]*CleanedRepositoryContent, error) {
	if contents == nil {
		return nil, nil
	}

	cleaned := make([]*CleanedRepositoryContent, len(contents))
	for i, content := range contents {
		cleanedContent, err := cleanRepositoryContent(content)
		if err != nil {
			return nil, err
		}
		cleaned[i] = cleanedContent
	}
	return cleaned, nil
}

// cleanRepositoryForSearch keeps URL fields for Repository in search results
func cleanRepositoryForSearch(repo *github.Repository) *CleanedRepository {
	if repo == nil {
		return nil
	}

	cleaned := &CleanedRepository{
		ID:       repo.ID,
		Name:     repo.Name,
		FullName: repo.FullName,
		Private:  repo.Private,
		Fork:     repo.Fork,
		HTMLURL:  repo.HTMLURL,
	}

	if repo.Owner != nil {
		cleaned.Owner = &CleanedUser{
			Login: repo.Owner.Login,
			ID:    repo.Owner.ID,
			Type:  repo.Owner.Type,
		}
	}

	return cleaned
}
