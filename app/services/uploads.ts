export interface UploadResult {
  /** Send as `photo_key` in `reports.create()`. */
  photo_key: string
  photo_url: string
}

export const uploadsService = (http: typeof $fetch) => ({
  /** Max 5 MB; compress client-side to ~800 px / ~200 KB first. 415 if not an image. */
  photo(file: Blob) {
    const body = new FormData()
    body.append('file', file)
    return http<UploadResult>('/uploads', { method: 'POST', body })
  }
})
