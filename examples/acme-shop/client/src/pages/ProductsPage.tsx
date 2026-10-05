import { useEffect, useState } from "react";
import { fetchProducts } from "@/api/orders";

export function ProductsPage() {
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetchProducts().then(setProducts);
  }, []);

  return (
    <ul>
      {products.map((product) => (
        <li key={product.id}>{product.name}</li>
      ))}
    </ul>
  );
}
