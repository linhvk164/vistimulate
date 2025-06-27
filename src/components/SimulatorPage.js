import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider';
import { impairmentDescriptions } from '../data/impairmentDescriptions';
import './css/SimulatorPage.css';

const SimulatorPage = () => {
  const impairments = [
    { id: 'macular_degeneration', name: 'Macular Degeneration' },
    { id: 'glaucoma', name: 'Glaucoma' },
    { id: 'cataracts', name: 'Cataracts' },
    { id: 'diabetic_retinopathy', name: 'Diabetic Retinopathy' },
    { id: 'high_myopia', name: 'High Myopia' },
    { id: 'protanopia', name: 'Protanopia' },
    { id: 'deuteranopia', name: 'Deuteranopia' },
    { id: 'tritanopia', name: 'Tritanopia' },
  ];

  const [selectedImpairment, setSelectedImpairment] = useState(impairments[0]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [transformedImageUrl, setTransformedImageUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Color space conversion functions
  function linearRGB_from_sRGB(v) {
    const fv = v / 255.0;
    if (fv < 0.04045) return fv / 12.92;
    return Math.pow((fv + 0.055) / 1.055, 2.4);
  }

  function sRGB_from_linearRGB(v) {
    if (v <= 0.) return 0;
    if (v >= 1.) return 255;
    if (v < 0.0031308) return 0.5 + (v * 12.92 * 255);
    return 0 + 255 * (Math.pow(v, 1.0 / 2.4) * 1.055 - 0.055);
  }

  // Brettel transformation parameters for color blindness simulation
  const brettel_params = {
    protan: {
      rgbCvdFromRgb_1: [
        0.14510, 1.20165, -0.34675,
        0.10447, 0.85316, 0.04237,
        0.00429, -0.00603, 1.00174
      ],
      rgbCvdFromRgb_2: [
        0.14115, 1.16782, -0.30897,
        0.10495, 0.85730, 0.03776,
        0.00431, -0.00586, 1.00155
      ],
      separationPlaneNormal: [0.00048, 0.00416, -0.00464]
    },
    deutan: {
      rgbCvdFromRgb_1: [
        0.36198, 0.86755, -0.22953,
        0.26099, 0.64512, 0.09389,
        -0.01975, 0.02686, 0.99289,
      ],
      rgbCvdFromRgb_2: [
        0.37009, 0.88540, -0.25549,
        0.25767, 0.63782, 0.10451,
        -0.01950, 0.02741, 0.99209,
      ],
      separationPlaneNormal: [-0.00293, -0.00645, 0.00938]
    },
    tritan: {
      rgbCvdFromRgb_1: [
        1.01354, 0.14268, -0.15622,
        -0.01181, 0.87561, 0.13619,
        0.07707, 0.81208, 0.11085,
      ],
      rgbCvdFromRgb_2: [
        0.93337, 0.19999, -0.13336,
        0.05809, 0.82565, 0.11626,
        -0.37923, 1.13825, 0.24098,
      ],
      separationPlaneNormal: [0.03960, -0.02831, -0.01129]
    },
  };

  // Brettel transformation function for color blindness simulation
  function brettel(rgb, t, severity) {
    const params = brettel_params[t];
    const separationPlaneNormal = params.separationPlaneNormal;
    const rgbCvdFromRgb_1 = params.rgbCvdFromRgb_1;
    const rgbCvdFromRgb_2 = params.rgbCvdFromRgb_2;

    // Check on which plane we should project by comparing with the separation plane normal.
    const dotWithSepPlane =
      rgb[0] * separationPlaneNormal[0] +
      rgb[1] * separationPlaneNormal[1] +
      rgb[2] * separationPlaneNormal[2];
    const rgbCvdFromRgb = dotWithSepPlane >= 0 ? rgbCvdFromRgb_1 : rgbCvdFromRgb_2;

    // Transform to the full dichromat projection plane.
    const rgb_cvd = Array(3);
    rgb_cvd[0] =
      rgbCvdFromRgb[0] * rgb[0] +
      rgbCvdFromRgb[1] * rgb[1] +
      rgbCvdFromRgb[2] * rgb[2];
    rgb_cvd[1] =
      rgbCvdFromRgb[3] * rgb[0] +
      rgbCvdFromRgb[4] * rgb[1] +
      rgbCvdFromRgb[5] * rgb[2];
    rgb_cvd[2] =
      rgbCvdFromRgb[6] * rgb[0] +
      rgbCvdFromRgb[7] * rgb[1] +
      rgbCvdFromRgb[8] * rgb[2];

    // Apply the severity factor as a linear interpolation.
    rgb_cvd[0] = rgb_cvd[0] * severity + rgb[0] * (1.0 - severity);
    rgb_cvd[1] = rgb_cvd[1] * severity + rgb[1] * (1.0 - severity);
    rgb_cvd[2] = rgb_cvd[2] * severity + rgb[2] * (1.0 - severity);

    return [
      sRGB_from_linearRGB(rgb_cvd[0]),
      sRGB_from_linearRGB(rgb_cvd[1]),
      sRGB_from_linearRGB(rgb_cvd[2]),
    ];
  }

  const applyTransformation = useCallback(async (image, impairment) => {
    if (!image) {
      throw new Error('No image provided');
    }

    return new Promise((resolve, reject) => {
      // Scale down large images to improve performance
      const maxDimension = 800; // Reduced from 1200 for better performance
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Optimize for pixel manipulation
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      const img = new Image();
      const objectUrl = URL.createObjectURL(image);
      img.src = objectUrl;

      img.onload = () => {
        console.log('Image loaded, starting processing...');
        try {
          let width = img.width;
          let height = img.height;
          
          // Scale down if image is too large
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = (height / width) * maxDimension;
              width = maxDimension;
            } else {
              width = (width / height) * maxDimension;
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;
          
          // Use better quality scaling
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          switch (impairment) {
            case 'protanopia':
            case 'deuteranopia':
            case 'tritanopia':
            case 'protanomaly':
            case 'deuteranomaly':
            case 'tritanomaly': {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const data = imageData.data;
              
              // Determine type and severity based on impairment
              let type, severity;
              switch (impairment) {
                case 'protanopia': type = 'protan'; severity = 1.0; break;
                case 'deuteranopia': type = 'deutan'; severity = 1.0; break;
                case 'tritanopia': type = 'tritan'; severity = 1.0; break;
                case 'protanomaly': type = 'protan'; severity = 0.6; break;
                case 'deuteranomaly': type = 'deutan'; severity = 0.6; break;
                case 'tritanomaly': type = 'tritan'; severity = 0.6; break;
              }

              for (let i = 0; i < data.length; i += 4) {
                const red = data[i];
                const green = data[i + 1];
                const blue = data[i + 2];

                // Convert sRGB to linear RGB
                const linearRed = linearRGB_from_sRGB(red);
                const linearGreen = linearRGB_from_sRGB(green);
                const linearBlue = linearRGB_from_sRGB(blue);

                // Apply the Brettel transformation
                const transformedRGB = brettel([linearRed, linearGreen, linearBlue], type, severity);

                data[i] = transformedRGB[0];
                data[i + 1] = transformedRGB[1];
                data[i + 2] = transformedRGB[2];
              }
              ctx.putImageData(imageData, 0, 0);
              break;
            }
            case 'glaucoma': {
              let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              let data = imageData.data;
              const centerX = canvas.width / 2;
              const centerY = canvas.height / 2;
              const maxRadius = Math.min(centerX, centerY);

              for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                  const pixelIndex = (y * canvas.width + x) * 4;

                  const distanceToCenter = Math.sqrt(
                    Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
                  );

                  const vignetteStrength = 1.3 - (distanceToCenter / maxRadius);

                  data[pixelIndex] *= vignetteStrength;
                  data[pixelIndex + 1] *= vignetteStrength;
                  data[pixelIndex + 2] *= vignetteStrength;
                }
              }
              ctx.putImageData(imageData, 0, 0);
              break;
            }
            case 'cataracts': {
              // First pass: Apply basic filters for overall effect
              ctx.filter = 'brightness(85%) contrast(85%) sepia(20%) blur(1px)';
              ctx.drawImage(img, 0, 0, width, height);
              
              // Second pass: Add glare and light scatter
              let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              let data = imageData.data;
              
              for (let i = 0; i < data.length; i += 4) {
                // Add white haze
                const hazeFactor = 0.3;
                data[i] = data[i] * (1 - hazeFactor) + 255 * hazeFactor;
                data[i + 1] = data[i + 1] * (1 - hazeFactor) + 255 * hazeFactor;
                data[i + 2] = data[i + 2] * (1 - hazeFactor) + 255 * hazeFactor;
                
                // Add slight yellow tint (simulating lens yellowing)
                const yellowTint = 0.15;
                data[i] += (255 - data[i]) * yellowTint;
                data[i + 1] += (255 - data[i + 1]) * yellowTint;
              }
              
              ctx.putImageData(imageData, 0, 0);
              
              // Third pass: Add bloom effect for bright areas
              ctx.globalCompositeOperation = 'lighter';
              ctx.filter = 'blur(5px) brightness(50%)';
              ctx.drawImage(img, 0, 0, width, height);
              ctx.globalCompositeOperation = 'source-over';
              break;
            }
          case 'diabetic_retinopathy': {
            ctx.filter = 'contrast(120%) brightness(90%)';
            ctx.drawImage(img, 0, 0, width, height);

            // Add dark spots
            const spots = 20;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            for (let i = 0; i < spots; i++) {
              const x = Math.random() * width;
              const y = Math.random() * height;
              const radius = Math.random() * 5 + 2;
              ctx.beginPath();
              ctx.arc(x, y, radius, 0, Math.PI * 2);
              ctx.fill();
            }
            break;
          }
          case 'high_myopia': {
            ctx.filter = 'blur(2px) brightness(90%)';
            ctx.drawImage(img, 0, 0, width, height);
            break;
          }
          default:
            ctx.drawImage(img, 0, 0, width, height);
          }
          resolve(canvas.toDataURL());
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image'));
      };
    });
  }, [brettel]);

  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedImage(file);
    }
  };

  useEffect(() => {
    let isMounted = true;
    let objectUrl = null;

    const updateTransformedImage = async () => {
      if (!selectedImage || !selectedImpairment) {
        setTransformedImageUrl(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      console.log('Starting transformation...');
      try {
        const transformedUrl = await applyTransformation(selectedImage, selectedImpairment.id);
        console.log('Transformation complete');
        if (isMounted) {
          // Clean up previous object URL
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
          }
          objectUrl = transformedUrl;
          setTransformedImageUrl(transformedUrl);
          setIsLoading(false); // Set loading to false after URL is set
        }
      } catch (error) {
        console.error('Failed to apply transformation:', error);
        if (isMounted) {
          setTransformedImageUrl(null);
          setIsLoading(false);
        }
      }
    };

    updateTransformedImage();

    return () => {
      isMounted = false;
      // Clean up object URL on unmount
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [selectedImage, selectedImpairment, applyTransformation]);

  return (
    <div className="simulator-page">
      <nav className="navbar">
        <div className="logo">
          <img src="/logo.svg" alt="ViSimulate Logo" className="logo-icon" />
          throughyoureyes
        </div>
        <div className="nav-links">
          <Link to="/how-it-works">How it Works</Link>
        </div>
      </nav>

      <main className="simulator-content">
        <div className="simulator-header">
          <div className="impairment-selector">
            {impairments.map((impairment) => (
              <div
                key={impairment.id}
                className={`impairment-option ${impairment.id === selectedImpairment.id ? 'active' : ''}`}
                onClick={() => setSelectedImpairment(impairment)}
              >
                <span className="impairment-tooltip">{impairment.name}</span>
              </div>
            ))}
          </div>
          
          <div className="content-area">
            <div className="impairment-header">
              <h1>{selectedImpairment.name}</h1>
              <div className="impairment-description">
                {impairmentDescriptions[selectedImpairment.id]}
              </div>
            </div>

            <div className="image-area">
              <div className="image-upload-area">
                {!selectedImage ? (
                  <div className="upload-prompt">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      id="image-upload"
                      className="hidden"
                    />
                    <label htmlFor="image-upload" className="upload-label">
                      <div className="upload-text">
                        <span>Drop your image here</span>
                        <span className="or-text">or</span>
                        <span className="browse-text">Browse</span>
                      </div>
                    </label>
                  </div>
                ) : (
                  <div className="image-comparison">
                    <ReactCompareSlider
                      position={50}
                      handle={
                        <div className="custom-handle">
                          <div className="handle-line"></div>
                        </div>
                      }
                      itemOne={
                        <ReactCompareSliderImage
                          src={URL.createObjectURL(selectedImage)}
                          alt="Original"
                        />
                      }
                      itemTwo={
                        <ReactCompareSliderImage
                          src={transformedImageUrl || URL.createObjectURL(selectedImage)}
                          alt="Transformed"
                        />
                      }
                    />
                  </div>
                )}
              </div>
              {selectedImage && (
                <div className="image-controls">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    id="image-replace"
                    className="hidden"
                  />
                  <label htmlFor="image-replace" className="control-button">
                    Replace Image
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default SimulatorPage;
