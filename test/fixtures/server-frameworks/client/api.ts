export async function fetchUser(id: string) {
  return fetch(`/api/users/${id}`);
}

export async function postReview(id: string) {
  return fetch(`/v1/books/${id}/reviews`, { method: "POST" });
}

export async function fetchOrder(id: string) {
  return fetch(`/shop/orders/${id}`);
}

export async function fetchAccount(id: string) {
  return fetch(`/api/accounts/${id}`);
}
