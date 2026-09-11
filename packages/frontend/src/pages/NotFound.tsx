import { Link } from 'react-router-dom';
import { Arrow, BrandMark } from '@/components/Brand';

export default function NotFound() {
  return (
    <div className="not-found site-width">
      <div className="not-found-art" aria-hidden="true"><span>4</span><BrandMark /><span>4</span></div>
      <p className="eyebrow">WELL, THAT’S A PUZZLER.</p>
      <h1>This page went missing.</h1>
      <p>Let’s get you back to the good stuff.</p>
      <Link to="/" className="nav-play">Back to the games <Arrow /></Link>
    </div>
  );
}
